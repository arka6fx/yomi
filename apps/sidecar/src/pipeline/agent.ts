import { streamText, type ToolSet } from "ai"
import type { AgentQueryRequest, Plan, SseEvent } from "@yomi/shared"
import { createModel } from "./model.js"
import { synthesize, resolveTts } from "./tts.js"
import { createAgentTools } from "../tools/index.js"
import { hooks, toolGuardrail, type Hooks } from "../harness/hooks.js"
import { buildAgentPrompt, loadYomiMd } from "../harness/prompt.js"
import { getConnectorRegistry } from "../connectors/registry.js"
import { LoopGuards } from "../harness/guards.js"
import { compressContext } from "../agent/index.js"
import { compact } from "../memory/compactor.js"
import { loadMemoryContext, writeSessionTurn } from "../memory/subsystem.js"
import { reserveInteraction } from "../automation/usage.js"
// import { setActEmitter } from "../uia/act-bus.js"    // will provide later
// import { getMcpTools } from "../mcp/client.js"       // will provide later
// import { wrapBrowserTools } from "../mcp/safety.js"   // will provide later
// import {
//   completeAutomation,
//   failAutomation,
//   previewAutomation,
//   redactAutomationPayload,
//   startAutomationRun,
//   stepAutomation,
//   timelineAutomation,
//   waitingAutomation,
// } from "../automation/runs.js"
// import {
//   adjustSystemVolume,
//   adjustSpotifyVolume,
//   controlSpotifyPlayback,
//   playSpotify,
//   saveWindowsNotepadAs,
//   writeWindowsNotepad,
// } from "../tools/system.js"    // will provide later
import {
  normalizeSpokenRecipient,
  pendingDraftRecipientRequest,
  // playbackControl,
  reminderDraftRequest,
  // spotifyPlaybackQuery,
  stripDetachedPhrases,
  // volumeAction,
  whatsAppMessageRequest,
} from "./shortcuts.js"

const AGENT_MODEL = process.env.AI_CREDITS_AGENT_MODEL || "gpt-5.5"
const MAX_STEPS = parseInt(process.env.AGENT_MAX_STEPS || "20", 10)
// 1M tokens for GPT-5.4-mini. Used by the turn-level compressor when no
// model-aware context length is available.
const DEFAULT_MODEL_CONTEXT_WINDOW = 1_000_000

let pendingWhatsAppDraft: { kind: "reminder"; message: string } | null = null
// let pendingWindowsNotepadDraft = false
// let pendingWhatsAppDraft: { kind: "reminder"; message: string } | null = null

export function __resetAgentShortcutStateForTest(): void {
  pendingWhatsAppDraft = null
  // pendingWindowsNotepadDraft = false
}

// yomi.md is stable per-session; memory files change after compaction so load fresh each turn.
let cachedYomiMd: string | null = null
function memoryEnabled(plan: Plan | undefined): boolean {
  return plan === "pro" || plan === "max"
}

async function getAgentPrompt(text: string, plan: Plan | undefined): Promise<string> {
  if (cachedYomiMd === null) cachedYomiMd = await loadYomiMd()
  const memory = memoryEnabled(plan)
  const memoryCtx = memory
    ? await loadMemoryContext(text)
    : {
        memorySummary: "",
        memoryIndex: "",
        localMemory: "",
        cloudRagContext: "",
        staticProfile: "",
        dynamicProfile: "",
        recentSession: "",
      }
  const connectedProviders = getConnectorRegistry().getConnected()
  return buildAgentPrompt({ yomiMd: cachedYomiMd, ...memoryCtx, connectedProviders })
}

// Detached-mode phrasing is stripped so it does not pollute command parsing.

// function isWindowsNotepadSaveFollowup(text: string): boolean { ... }
// function notepadSavePath(text: string): string | null { ... }
// function stripNotepadTarget(text: string): string { ... }
// export function windowsNotepadRequest(...): ... { ... }

// Re-export for test imports (canonical definition in shortcuts.ts).
// export { whatsAppMessageRequest } from "./shortcuts.js" // will provide later

type WriteSessionTurn = typeof writeSessionTurn
type ExecutableTool = { execute?: (args: unknown, opts: unknown) => PromiseLike<unknown> }
type AgentStreamEvent =
  | { type: "text-delta"; textDelta: string }
  | { type: "tool-call"; toolName: string; args: unknown }
  | { type: "tool-result"; toolName: string; result: unknown }
  | { type: "step-finish" }
  | { type: "error"; error: unknown }
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
        | "finish"
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
  }

  const system = await getAgentPrompt(req.text, req.plan)
  const guards = new LoopGuards()
  const activeHooks = opts?.hooks ?? hooks
  const signal = opts?.signal
  const writeTurn = opts?.writeSessionTurn ?? writeSessionTurn

  // Track pending message drafts for follow-up resolution
  let pendingMessageDraft: { recipient: string; message: string } | null = null

  const ttsEnabled = req.tts !== false && resolveTts() !== "none"
  let fullText = ""

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
      yield { type: "agent_tool_call", tool: "send_message", args: { recipient: pd.recipient, message: pd.message, chatId: draftRecipient } }
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
      yield { type: "agent_text", text: `I'll send "${whatsAppMessage.message}" to ${whatsAppMessage.recipient}. Who should I send it to?` }
      await activeHooks.onStop("messaging recipient needed")
      yield { type: "done" }
      return
    }

    const reminderDraft = reminderDraftRequest(cleanText)
    if (reminderDraft) {
      pendingMessageDraft = { recipient: "reminder", message: reminderDraft.message }
      yield { type: "agent_text", text: `I'll remind you to "${reminderDraft.message}". When should I remind you?` }
      await activeHooks.onStop("reminder time needed")
      yield { type: "done" }
      return
    }

    // Build tools for the full agent loop.
    const mcpTools = {}
    const tools = applyHooks(
      {
        ...createAgentTools({ screenshotB64: req.screenshot_b64, plan: req.plan }),
        ...mcpTools,
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

    const result = streamText({
      model: createModel(AGENT_MODEL),
      system,
      messages: preCompressedMessages as unknown as Parameters<typeof streamText>[0]["messages"],
      tools,
      maxSteps: MAX_STEPS,
      abortSignal: signal,
    })

    let stepCount = 0
    let textTail = ""

    for await (const event of result.fullStream as AsyncIterable<AgentStreamEvent>) {
      switch (event.type) {
        case "text-delta":
          textTail = (textTail + event.textDelta).slice(-200)
          if (ttsEnabled) fullText += event.textDelta
          yield { type: "agent_text", text: event.textDelta }
          break
        case "tool-call": {
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
          stepCount++
          yield { type: "agent_step", iteration: stepCount, max: MAX_STEPS }
          const guard = guards.onStep()
          if (guard.break) {
            yield { type: "error", message: guard.reason }
            await activeHooks.onStop(guard.reason)
            return
          }
          break
        }
        case "error":
          yield {
            type: "error",
            message: event.error instanceof Error ? event.error.message : String(event.error),
          }
          return
      }
    }

    const summary = textTail.replace(/\n/g, " ").trim() || "agent task complete"
    await activeHooks.onStop(summary)
    if (memoryEnabled(req.plan)) {
      await writeTurn({ kind: "agent", input: req.text, output: summary, summary })
      compact({ plan: req.plan }).catch((err) =>
        console.warn("[yomi/agent] compaction error:", err),
      )
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
        console.warn("[yomi/agent] TTS synthesis failed:", err instanceof Error ? err.message : String(err))
        yield { type: "tts_error", message: "Voice synthesis failed. Text response is still available." }
      }
    }
    yield { type: "done" }
  } finally {
    // Cleanup
  }
}
