import { generateText, streamText, type ToolSet } from "ai"
import type { AgentQueryRequest, Plan, SseEvent } from "@yomi/shared"
import { createModel } from "./model.js"
import { synthesize, resolveTts } from "./tts.js"
import { createAgentTools } from "../tools/index.js"
import { hooks, toolGuardrail, type Hooks } from "../harness/hooks.js"
import { buildAgentPrompt, loadSoulMd, loadYomiMd } from "../harness/prompt.js"
import { getConnectorRegistry } from "../connectors/registry.js"
import { LoopGuards } from "../harness/guards.js"
import { compressContext, IterationBudget, DEFAULT_ITERATION_BUDGET } from "../agent/index.js"
import { loadMemoryContext, writeSessionTurn } from "../memory/subsystem.js"
import { finalizeInteractionUsage, reserveInteraction } from "../usage/reserve.js"
import {
  canProceed,
  cooldownRemaining,
  recordRateLimit,
  recordSuccess,
  isRateLimitError,
  isBillingError,
  jitteredBackoff,
  sleep,
  RateLimitError,
  BillingError,
} from "../agent/rate-limiter.js"
import {
  normalizeSpokenRecipient,
  pendingDraftRecipientRequest,
  reminderDraftRequest,
  stripDetachedPhrases,
  whatsAppMessageRequest,
} from "./shortcuts.js"
import { maybeHandleSoulOnboarding } from "./soul-onboarding.js"

const AGENT_MODEL = process.env.AI_CREDITS_AGENT_MODEL || "gpt-5.5"
const AGENT_MAX_STEPS = parseInt(process.env.AGENT_MAX_STEPS || "25", 10)
// 1M tokens for GPT-5.4-mini. Used by the turn-level compressor when no
// model-aware context length is available.
const DEFAULT_MODEL_CONTEXT_WINDOW = 1_000_000

// Combine multiple AbortSignals into one. Triggers when any input signal aborts.
function anySignal(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason)
      return controller.signal
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true })
  }
  return controller.signal
}

let pendingWhatsAppDraft: { kind: "reminder"; message: string } | null = null
// let pendingWindowsNotepadDraft = false
// let pendingWhatsAppDraft: { kind: "reminder"; message: string } | null = null

export function __resetAgentShortcutStateForTest(): void {
  pendingWhatsAppDraft = null
  // pendingWindowsNotepadDraft = false
}

// yomi.md is stable per-session; memory files change after compaction so load fresh each turn.
let cachedYomiMd: string | null = null
let cachedSoulMd: string | null = null
function memoryEnabled(plan: Plan | undefined): boolean {
  return plan === "pro" || plan === "max"
}

async function getAgentPrompt(text: string, plan: Plan | undefined): Promise<string> {
  if (cachedYomiMd === null) cachedYomiMd = await loadYomiMd()
  if (cachedSoulMd === null) cachedSoulMd = await loadSoulMd()
  const memory = memoryEnabled(plan)
  const memoryCtx = memory
    ? await loadMemoryContext(text)
    : {
        memorySummary: "",
        memoryIndex: "",
        durableMemory: "",
        localMemory: "",
        cloudRagContext: "",
        staticProfile: "",
        dynamicProfile: "",
        recentSession: "",
      }
  const connectedProviders = getConnectorRegistry().getConnected()
  return buildAgentPrompt({
    yomiMd: cachedYomiMd,
    soulMd: cachedSoulMd,
    ...memoryCtx,
    connectedProviders,
  })
}

// Detached-mode phrasing is stripped so it does not pollute command parsing.

// function isWindowsNotepadSaveFollowup(text: string): boolean { ... }
// function notepadSavePath(text: string): string | null { ... }
// function stripNotepadTarget(text: string): string { ... }
// export function windowsNotepadRequest(...): ... { ... }

// Re-export for test imports (canonical definition in shortcuts.ts).
type WriteSessionTurn = typeof writeSessionTurn
type ExecutableTool = { execute?: (args: unknown, opts: unknown) => PromiseLike<unknown> }
type AgentStreamEvent =
  | { type: "text-delta"; textDelta: string }
  | { type: "tool-call"; toolName: string; args: unknown }
  | { type: "tool-result"; toolName: string; result: unknown }
  | { type: "step-finish" }
  | { type: "error"; error: unknown }
  | { type: "finish"; usage?: { promptTokens?: number; completionTokens?: number } }
  | { type: "rate_limit_wait"; seconds: number }
  | { type: "rate_limit_exhausted" }
  | {
      type:
        | "reasoning"
        | "file"
        | "redacted-reasoning"
        | "reasoning-signature"
        | "source"
        | "tool-call-streaming-start"
        | "tool-call-delta"
        | "step-start"
    }

function shortcutFailed(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    ("error" in result || ("ok" in result && (result as { ok?: unknown }).ok === false))
  )
}

// Wrap all tool execute functions with PreToolUse / PostToolUse hook calls.
function applyHooks(tools: ToolSet, activeHooks: Hooks): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => [
      name,
      {
        ...t,
        execute: async (args: unknown, opts: unknown) => {
          const check = await activeHooks.onPreToolUse(name, args)
          if (!check.ok) {
            console.warn(`[yomi/agent] denied: ${name} — ${check.reason}`)
            return `[DENIED: ${check.reason}]`
          }
          const result = await (t as ExecutableTool).execute?.(args, opts)
          return activeHooks.onPostToolUse(name, result, args)
        },
      },
    ]),
  ) as ToolSet
}

export async function* agentPipeline(
  req: AgentQueryRequest,
  opts?: {
    emit?: (e: SseEvent) => void
    hooks?: Hooks
    writeSessionTurn?: WriteSessionTurn
    signal?: AbortSignal
  },
): AsyncGenerator<SseEvent> {
  const soulOnboarding = maybeHandleSoulOnboarding(req.text)
  if (soulOnboarding) {
    yield { type: "agent_text", text: soulOnboarding }
    yield { type: "done" }
    return
  }

  let usageEventId: string | undefined
  if (!req.skipReserve) {
    const reservation = await reserveInteraction("chat")
    if (!reservation.ok) {
      yield {
        type: "usage_limit",
        code: reservation.code,
        feature: reservation.feature ?? "chat",
        message: reservation.error,
        upgradeUrl: reservation.upgradeUrl,
      }
      return
    }
    usageEventId = reservation.usageEventId
  }

  const system = await getAgentPrompt(req.text, req.plan)
  const guards = new LoopGuards()
  const activeHooks = opts?.hooks ?? hooks
  const signal = opts?.signal
  const writeTurn = opts?.writeSessionTurn ?? writeSessionTurn

  // Cost-aware iteration budget with step + output token limits.
  // When exhausted, switches to a tool-less summary call instead of hard-stop.
  const budget = new IterationBudget({
    maxSteps: AGENT_MAX_STEPS,
  })
  let budgetExhausted = false
  let budgetAbort: AbortController | null = null

  // Track pending message drafts for follow-up resolution
  let pendingMessageDraft: { recipient: string; message: string } | null = null

  const ttsEnabled = req.tts !== false && resolveTts() !== "none"
  let fullText = ""
  const startedAt = Date.now()
  let inputTokens = 0
  let outputTokens = 0
  let toolCalls = 0

  try {
    if (signal?.aborted) {
      yield { type: "done" }
      return
    }

    const cleanText = stripDetachedPhrases(req.text)

    // ── Messaging shortcuts ────────────────────────────────────────────────
    const draftRecipient = pendingDraftRecipientRequest(cleanText, pendingMessageDraft !== null)
    if (draftRecipient) {
      const pd: { recipient: string; message: string } = pendingMessageDraft!
      yield {
        type: "agent_tool_call",
        tool: "send_message",
        args: { recipient: pd.recipient, message: pd.message, chatId: draftRecipient },
      }
      yield { type: "agent_tool_result", tool: "send_message", result: { ok: true } }
      pendingMessageDraft = null
      yield { type: "agent_text", text: `Sent message to ${draftRecipient}.` }
      await activeHooks.onStop(`messaged ${draftRecipient}`)
      yield { type: "done" }
      return
    }

    const whatsAppMessage = whatsAppMessageRequest(cleanText)
    if (whatsAppMessage) {
      pendingMessageDraft = whatsAppMessage
      yield {
        type: "agent_text",
        text: `I'll send "${whatsAppMessage.message}" to ${whatsAppMessage.recipient}. Who should I send it to?`,
      }
      await activeHooks.onStop("messaging recipient needed")
      yield { type: "done" }
      return
    }

    const reminderDraft = reminderDraftRequest(cleanText)
    if (reminderDraft) {
      pendingMessageDraft = { recipient: "reminder", message: reminderDraft.message }
      yield {
        type: "agent_text",
        text: `I'll remind you to "${reminderDraft.message}". When should I remind you?`,
      }
      await activeHooks.onStop("reminder time needed")
      yield { type: "done" }
      return
    }

    // Build tools for the full agent loop.
    const tools = applyHooks(
      {
        ...createAgentTools({ screenshotB64: req.screenshot_b64, plan: req.plan }),
      },
      activeHooks,
    )

    // Reset the per-turn guardrail controller — each streamText burst is a fresh
    // observation window. LoopGuards reads the halt decision in onStep().
    toolGuardrail.resetForTurn()

    // Pre-burst compression: when the caller's prior history pushes the message
    // list past the plan's threshold, summarise the middle before streamText so
    // the burst is cheaper and finishes inside the model's window.
    const baseMessages: { role: "user" | "assistant" | "system"; content: string }[] = [
      ...(req.history ?? []).map((h) => ({ role: h.role, content: h.text })),
      { role: "user" as const, content: req.text },
    ]
    let preCompressedMessages: { role: "user" | "assistant" | "system"; content: string }[] =
      baseMessages
    const compression = await compressContext(
      baseMessages as unknown as Parameters<typeof compressContext>[0],
      {
        contextWindow: DEFAULT_MODEL_CONTEXT_WINDOW,
        plan: req.plan,
        signal,
      },
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[yomi/agent] compression error: ${msg}`)
      return null
    })
    if (compression?.compressed) {
      preCompressedMessages = compression.messages as typeof baseMessages
    }

    // When budget is exhausted during the streamText loop, we abort and
    // do a final tool-less summary call. This AbortController drives that.
    budgetAbort = new AbortController()
    const combinedSignal = signal ? anySignal(signal, budgetAbort.signal) : budgetAbort.signal

    // ── Cross-session circuit breaker for LLM rate limits ─────────
    if (!(await canProceed("ai-credits"))) {
      const seconds = await cooldownRemaining("ai-credits")
      yield {
        type: "rate_limit",
        message: `Rate limited. Try again in ${seconds}s.`,
        seconds,
      }
      await activeHooks.onStop("rate limited")
      yield { type: "done" }
      return
    }

    const agentMaxTokens = parseInt(process.env["AI_CREDITS_MAX_TOKENS"] || "4096", 10)

    const MAX_RETRIES = parseInt(process.env["AGENT_RATE_LIMIT_RETRIES"] || "3", 10)
    let result: Awaited<ReturnType<typeof streamText>> | null = null
    let retryAttempt = 0

    while (retryAttempt < MAX_RETRIES && result === null) {
      retryAttempt++
      try {
        result = streamText({
          model: createModel(AGENT_MODEL),
          system,
          messages: preCompressedMessages as unknown as Parameters<
            typeof streamText
          >[0]["messages"],
          tools,
          maxSteps: AGENT_MAX_STEPS + 10,
          maxTokens: agentMaxTokens,
          abortSignal: combinedSignal,
        }) as Awaited<ReturnType<typeof streamText>>
      } catch (err: unknown) {
        if (isBillingError(err)) throw err
        if (!isRateLimitError(err)) throw err

        const rateErr = err as RateLimitError
        await recordRateLimit(rateErr.retryAfterSeconds, "ai-credits")

        if (retryAttempt < MAX_RETRIES) {
          const wait = jitteredBackoff(retryAttempt)
          yield {
            type: "agent_text",
            text: `\n[Rate limited. Retrying in ${Math.round(wait / 1000)}s...]`,
          }
          await sleep(wait)
        } else {
          throw err
        }
      }
    }

    let stepCount = 0
    let textTail = ""
    let stepOutputChars = 0
    let maxStepsReached = false

    if (!result) throw new Error("streamText returned null after retries")
    for await (const event of result.fullStream as AsyncIterable<AgentStreamEvent>) {
      switch (event.type) {
        case "text-delta":
          stepOutputChars += event.textDelta.length
          textTail = (textTail + event.textDelta).slice(-200)
          if (ttsEnabled) fullText += event.textDelta
          yield { type: "agent_text", text: event.textDelta }
          break
        case "tool-call": {
          toolCalls++
          const guard = guards.onToolCall(event.toolName, event.args as Record<string, unknown>)
          yield {
            type: "agent_tool_call",
            tool: event.toolName,
            args: event.args as Record<string, unknown>,
          }
          if (guard.break) {
            yield { type: "error", message: guard.reason }
            await activeHooks.onStop(guard.reason)
            return
          }
          break
        }
        case "tool-result":
          yield { type: "agent_tool_result", tool: event.toolName, result: event.result }
          break
        case "step-finish": {
          const stepTokenEstimate = Math.ceil(stepOutputChars / 4)
          stepOutputChars = 0

          if (!budget.consume(stepTokenEstimate)) {
            budgetExhausted = true
            budgetAbort.abort()
            break
          }

          stepCount++
          yield { type: "agent_step", iteration: stepCount, max: AGENT_MAX_STEPS }
          const guard = guards.onStep()
          if (guard.break) {
            yield { type: "error", message: guard.reason }
            await activeHooks.onStop(guard.reason)
            return
          }
          break
        }
        case "finish":
          inputTokens = event.usage?.promptTokens ?? inputTokens
          outputTokens = event.usage?.completionTokens ?? outputTokens
          await recordSuccess("ai-credits")
          break
        case "error": {
          const err: unknown = event.error
          if (isBillingError(err)) {
            await recordRateLimit(undefined, "ai-credits")
            finalizeInteractionUsage({
              usageEventId,
              model: AGENT_MODEL,
              inputTokens,
              outputTokens,
              status: "error",
              metadata: {
                endpoint: "sidecar.agent",
                route: "agent",
                latencyMs: Date.now() - startedAt,
                toolCalls,
                error: err instanceof Error ? err.message : String(err),
              },
            })
            yield {
              type: "error",
              message: err instanceof Error ? err.message : String(err),
            }
            return
          }

          if (isRateLimitError(err)) {
            const retryAfter = err instanceof RateLimitError ? err.retryAfterSeconds : undefined
            await recordRateLimit(retryAfter, "ai-credits")
          }

          finalizeInteractionUsage({
            usageEventId,
            model: AGENT_MODEL,
            inputTokens,
            outputTokens,
            status: "error",
            metadata: {
              endpoint: "sidecar.agent",
              route: "agent",
              latencyMs: Date.now() - startedAt,
              toolCalls,
              error: err instanceof Error ? err.message : String(err),
            },
          })
          yield {
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          }
          return
        }
      }
    }

    // ── Budget exhaustion: final tool-less summary call ──────────────
    if (budgetExhausted) {
      const exhaustedReason = budget.exhaustedReason
      const budgetDetails = budget.details
      console.warn(
        `[yomi/agent] budget exhausted (${exhaustedReason}: ${budgetDetails.usedSteps}/${budgetDetails.maxSteps} steps, ${budgetDetails.usedOutputTokens}/${budgetDetails.maxOutputTokens} tokens) — requesting summary`,
      )
      try {
        const { text: summaryText } = await generateText({
          model: createModel(AGENT_MODEL),
          system: [
            system,
            "You've reached the maximum budget for tool-calling steps. " +
              "Provide a final response summarizing what you've done so far, " +
              "without calling any more tools.",
          ].join("\n\n"),
          prompt: `The user asked: "${req.text}"\n\nSummarize what was accomplished during this session. Be concise.`,
          abortSignal: signal,
        })
        if (summaryText?.trim()) {
          fullText += "\n" + summaryText
          yield { type: "agent_text", text: summaryText }
        }
      } catch (err) {
        console.warn(
          "[yomi/agent] budget summary generation failed:",
          err instanceof Error ? err.message : String(err),
        )
      }
    }

    finalizeInteractionUsage({
      usageEventId,
      model: AGENT_MODEL,
      inputTokens,
      outputTokens,
      status: signal?.aborted ? "cancelled" : budgetExhausted ? "budget_exhausted" : "done",
      metadata: {
        endpoint: "sidecar.agent",
        route: "agent",
        latencyMs: Date.now() - startedAt,
        toolCalls,
        steps: stepCount,
        outputChars: fullText.length,
        hasScreen: Boolean(req.screenshot_b64),
        tts: ttsEnabled,
        budgetExhausted: budgetExhausted ? budget.exhaustedReason : undefined,
      },
    })

    const summary = textTail.replace(/\n/g, " ").trim() || "agent task complete"
    await activeHooks.onStop(summary)
    if (memoryEnabled(req.plan)) {
      await writeTurn({ kind: "agent", input: req.text, output: summary, summary })
    }
    if (ttsEnabled && fullText.trim()) {
      try {
        const chunks: Uint8Array[] = []
        for await (const audio of synthesize(fullText.trim())) chunks.push(audio)
        if (chunks.length > 0) {
          const totalLen = chunks.reduce((acc, c) => acc + c.length, 0)
          const merged = new Uint8Array(totalLen)
          let offset = 0
          for (const c of chunks) {
            merged.set(c, offset)
            offset += c.length
          }
          yield { type: "audio_chunk", base64: Buffer.from(merged).toString("base64") }
        }
      } catch (err) {
        console.warn(
          "[yomi/agent] TTS synthesis failed:",
          err instanceof Error ? err.message : String(err),
        )
        yield {
          type: "tts_error",
          message: "Voice synthesis failed. Text response is still available.",
        }
      }
    }
    yield { type: "done" }
  } finally {
    // Cleanup
  }
}
