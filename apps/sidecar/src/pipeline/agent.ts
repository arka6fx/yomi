import { streamText, type ToolSet } from "ai"
import type { AgentQueryRequest, Plan, SseEvent } from "@yomi/shared"
import { createModel } from "./model.js"
import { createAgentTools } from "../tools/index.js"
import { hooks, toolGuardrail, type Hooks } from "../harness/hooks.js"
import { buildAgentPrompt, loadYomiMd } from "../harness/prompt.js"
import { LoopGuards } from "../harness/guards.js"
import { compressContext } from "../agent/index.js"
import { compact } from "../memory/compactor.js"
import { loadMemoryContext, writeSessionTurn } from "../memory/subsystem.js"
import { setActEmitter } from "../uia/act-bus.js"
import { getMcpTools } from "../mcp/client.js"
import { wrapBrowserTools } from "../mcp/safety.js"
import {
  completeAutomation,
  failAutomation,
  previewAutomation,
  redactAutomationPayload,
  startAutomationRun,
  stepAutomation,
  timelineAutomation,
  waitingAutomation,
} from "../automation/runs.js"
import {
  adjustSystemVolume,
  adjustSpotifyVolume,
  controlSpotifyPlayback,
  playSpotify,
  sendWhatsAppMessage,
  saveWindowsNotepadAs,
  writeWindowsNotepad,
} from "../tools/system.js"
import {
  normalizeSpokenRecipient,
  pendingDraftRecipientRequest,
  playbackControl,
  reminderDraftRequest,
  spotifyPlaybackQuery,
  stripDetachedPhrases,
  volumeAction,
  whatsAppMessageRequest,
} from "./shortcuts.js"

const AGENT_PATH_MODEL = process.env.AGENT_PATH_MODEL || "gpt-4.1"
const MAX_STEPS = parseInt(process.env.AGENT_MAX_STEPS || "20", 10)
// 1M tokens for gpt-4.1 family. Used by the turn-level compressor when no
// model-aware context length is available. Matches the published 4.1 window.
const DEFAULT_MODEL_CONTEXT_WINDOW = 1_000_000

let pendingWhatsAppDraft: { kind: "reminder"; message: string } | null = null
let pendingWindowsNotepadDraft = false

export function __resetAgentShortcutStateForTest(): void {
  pendingWhatsAppDraft = null
  pendingWindowsNotepadDraft = false
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
  return buildAgentPrompt({ yomiMd: cachedYomiMd, ...memoryCtx })
}

// Detached-mode phrasing is stripped so it does not pollute command parsing.

function isWindowsNotepadSaveFollowup(text: string): boolean {
  if (!pendingWindowsNotepadDraft) return false
  return /\b(save|store)\s+(?:it|this|that|the\s+(?:note|file|draft))\b/i.test(text.trim())
}

function notepadSavePath(text: string): string | null {
  if (!/\b(save|store)\b/i.test(text)) return null
  if (!/\b(notepad|txt|text\s+file|file|document|it|this|that|note|draft)\b/i.test(text)) {
    return null
  }
  const match =
    text.match(
      /\b(?:save|store)\s+(?:this|that|the)?\s*(?:open(?:ed)?\s+)?(?:notepad(?:\s+file)?|txt|text\s+file|file|document|note|draft)\s+(?:as|to|at|in)\s+(.+)$/i,
    ) ??
    text.match(
      /\b(?:save|store)\s+(?:the\s+)?(?:notepad(?:\s+file)?|txt|text\s+file|file|document|note|draft|it|this|that)?\s*(?:file\s*)?(?:as|to|at|in)\s+(.+)$/i,
    )
  const path = match?.[1]?.trim().replace(/^["'`]|["'`]$/g, "")
  if (!path) return null
  if (!/(desktop|documents|downloads|[\\/]|:|\.txt\b)/i.test(path)) return null
  return path || null
}

function stripNotepadTarget(text: string): string {
  return text
    .replace(/\b(?:in|into|on|to|inside)\s+(?:the\s+)?(?:windows\s+)?notepad\b/gi, " ")
    .replace(
      /\b(?:open|launch|start)\s+(?:the\s+)?(?:windows\s+)?notepad(?:\s+(?:and|to))?\b/gi,
      " ",
    )
    .replace(/\b(?:write|wright|type|put|draft|make|create|note)\s+(?:down\s+)?(?:this\s+)?/gi, " ")
    .replace(/\b(?:and\s+)?(?:save|store)\s+(?:it|this|that|the\s+(?:note|file|draft))\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/[.?!]+$/g, "")
    .trim()
}

export function windowsNotepadRequest(
  text: string,
): { content: string; needsMemory: boolean; wantsSave: boolean } | null {
  if (!/\b(?:the\s+)?(?:windows\s+)?notepad\b/i.test(text)) return null
  const wantsWrite = /\b(write|wright|type|put|draft|make|create|note)\b/i.test(text)
  const wantsSave = /\b(save|store)\b/i.test(text)
  const asksKnownAboutMe =
    /\b(?:(?:what|things|stuff|struffs)\s+you|thingsyou)\s+(?:know|knoe)\s+about\s+me\b/i.test(text)
  if (!wantsWrite && !wantsSave && !asksKnownAboutMe) return null

  const content = stripNotepadTarget(text)
  return {
    content,
    needsMemory: asksKnownAboutMe,
    wantsSave,
  }
}

// Re-export for test imports (canonical definition in shortcuts.ts).
export { whatsAppMessageRequest } from "./shortcuts.js"

type WriteSessionTurn = typeof writeSessionTurn
type ShortcutSystemActions = {
  adjustSystemVolume: typeof adjustSystemVolume
  adjustSpotifyVolume: typeof adjustSpotifyVolume
  controlSpotifyPlayback: typeof controlSpotifyPlayback
  playSpotify: typeof playSpotify
  sendWhatsAppMessage: typeof sendWhatsAppMessage
  saveWindowsNotepadAs: typeof saveWindowsNotepadAs
  writeWindowsNotepad: typeof writeWindowsNotepad
}

async function notepadKnownAboutMeText(plan: Plan | undefined): Promise<string> {
  if (!memoryEnabled(plan)) {
    return "I do not have Yomi memory enabled for this plan, so I do not have saved personal notes to summarize yet."
  }
  const ctx = await loadMemoryContext("what you know about me user profile preferences facts")
  const sections: Array<[string, string]> = [
    ["Static profile", ctx.staticProfile] as [string, string],
    ["Dynamic profile", ctx.dynamicProfile] as [string, string],
    ["Memory summary", ctx.memorySummary] as [string, string],
    ["Relevant memories", ctx.localMemory] as [string, string],
  ].filter(([, value]) => value.trim())

  if (sections.length === 0) {
    return "I do not have saved personal notes about you yet. Tell me what to add, and I can write it here."
  }

  return sections.map(([label, value]) => `${label}\n${value.trim()}`).join("\n\n")
}

async function rememberAgentShortcut(
  req: AgentQueryRequest,
  output: string,
  writeTurn: WriteSessionTurn,
): Promise<void> {
  if (!memoryEnabled(req.plan)) return
  await writeTurn({ kind: "agent", input: req.text, output, summary: output })
}

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

// `emit` lets Act-mode tools push act_proposed/act_result onto the live SSE stream (Spec 16).
export async function* agentPipeline(
  req: AgentQueryRequest,
  opts?: {
    emit?: (e: SseEvent) => void
    hooks?: Hooks
    system?: ShortcutSystemActions
    writeSessionTurn?: WriteSessionTurn
    signal?: AbortSignal
  },
): AsyncGenerator<SseEvent> {
  const system = await getAgentPrompt(req.text, req.plan)
  const automation = startAutomationRun(req.text)
  let automationClosed = false
  for (const event of automation.events) yield event
  yield previewAutomation(automation)
  yield timelineAutomation(automation, "Prepared automation preview", "planned")
  const closeAutomation = (summary: string, failed = false): SseEvent => {
    automationClosed = true
    return failed ? failAutomation(automation, summary) : completeAutomation(automation, summary)
  }
  const guards = new LoopGuards()
  const activeHooks = opts?.hooks ?? hooks
  // When the desktop barges in (talk-to-interrupt) the fetch aborts; honor it so a superseded run
  // stops driving apps and releases the shared UIA helper instead of running on as a zombie.
  const signal = opts?.signal
  const systemActions = opts?.system ?? {
    adjustSystemVolume,
    adjustSpotifyVolume,
    controlSpotifyPlayback,
    playSpotify,
    sendWhatsAppMessage,
    saveWindowsNotepadAs,
    writeWindowsNotepad,
  }
  const writeTurn = opts?.writeSessionTurn ?? writeSessionTurn
  if (opts?.emit)
    setActEmitter((event) => {
      if (event.type === "act_proposed") {
        opts.emit?.(waitingAutomation(automation, event.label, "dangerous"))
        opts.emit?.(
          timelineAutomation(automation, `Waiting for approval: ${event.label}`, "waiting"),
        )
      } else if (event.type === "act_result") {
        opts.emit?.(
          timelineAutomation(automation, event.label, event.ok ? "done" : "failed", event.detail),
        )
      }
      opts.emit?.(event)
    })

  try {
    // Already superseded before we did anything — exit quietly, no red error.
    if (signal?.aborted) {
      yield closeAutomation("Automation cancelled.", true)
      yield { type: "done" }
      return
    }

    const cleanText = stripDetachedPhrases(req.text)

    const savePath = notepadSavePath(cleanText)
    if (savePath) {
      const args = { path: savePath }
      yield stepAutomation(automation, "Save Notepad file")
      yield timelineAutomation(automation, "Save Notepad file", "running", JSON.stringify(args))
      yield { type: "agent_tool_call", tool: "save_windows_notepad_as", args }
      const check = await activeHooks.onPreToolUse("save_windows_notepad_as", args)
      const result = check.ok
        ? await activeHooks.onPostToolUse(
            "save_windows_notepad_as",
            await systemActions.saveWindowsNotepadAs(savePath),
          )
        : `[DENIED: ${check.reason}]`
      yield { type: "agent_tool_result", tool: "save_windows_notepad_as", result }
      const failed = shortcutFailed(result)
      const savedPath =
        typeof result === "object" && result !== null && "path" in result
          ? String((result as { path: unknown }).path)
          : savePath
      const output = failed
        ? "I could not save the Notepad file."
        : `I saved the Notepad file to ${savedPath}.`
      yield { type: "agent_text", text: output }
      await activeHooks.onStop(failed ? "notepad save failed" : "notepad file saved")
      if (!failed) await rememberAgentShortcut(req, output, writeTurn)
      yield timelineAutomation(automation, output, failed ? "failed" : "done")
      yield closeAutomation(output, failed)
      yield { type: "done" }
      return
    }

    if (isWindowsNotepadSaveFollowup(cleanText)) {
      const output = "Where should I save the Notepad file, and what should I name it?"
      yield waitingAutomation(automation, output, "moderate")
      yield timelineAutomation(automation, output, "waiting")
      yield { type: "agent_text", text: output }
      await activeHooks.onStop("notepad save location needed")
      yield closeAutomation("Waiting for save location.")
      yield { type: "done" }
      return
    }

    // Spotify transport (pause/resume/next/previous/stop) via media keys.
    const control = playbackControl(cleanText)
    if (control) {
      const args = { action: control }
      yield stepAutomation(automation, "Control Spotify playback")
      yield timelineAutomation(automation, "Control Spotify playback", "running")
      yield { type: "agent_tool_call", tool: "control_spotify", args }
      const check = await activeHooks.onPreToolUse("control_spotify", args)
      const result = check.ok
        ? await activeHooks.onPostToolUse(
            "control_spotify",
            await systemActions.controlSpotifyPlayback(control),
          )
        : `[DENIED: ${check.reason}]`
      yield { type: "agent_tool_result", tool: "control_spotify", result }
      const failed = typeof result === "object" && result !== null && "error" in result
      const verb =
        control === "next"
          ? "Skipped to the next track"
          : control === "previous"
            ? "Went to the previous track"
            : control === "stop"
              ? "Stopped playback"
              : control === "resume"
                ? "Resumed Spotify"
                : "Paused Spotify"
      const output = failed ? "I could not control Spotify playback." : `${verb}.`
      yield timelineAutomation(automation, output, failed ? "failed" : "done")
      yield { type: "agent_text", text: output }
      await activeHooks.onStop(failed ? "spotify control failed" : "spotify control done")
      if (!failed) await rememberAgentShortcut(req, output, writeTurn)
      yield closeAutomation(output, failed)
      yield { type: "done" }
      return
    }

    const volume = volumeAction(cleanText)
    if (volume) {
      const spotify = volume.target === "spotify"
      const toolName = spotify ? "adjust_spotify_volume" : "adjust_volume"
      const args = { direction: volume.direction, steps: volume.steps }
      yield stepAutomation(automation, spotify ? "Adjust Spotify volume" : "Adjust system volume")
      yield timelineAutomation(
        automation,
        spotify ? "Adjust Spotify volume" : "Adjust system volume",
        "running",
      )
      yield { type: "agent_tool_call", tool: toolName, args }
      const check = await activeHooks.onPreToolUse(toolName, args)
      const result = check.ok
        ? await activeHooks.onPostToolUse(
            toolName,
            spotify
              ? await systemActions.adjustSpotifyVolume(volume.direction, volume.steps, { signal })
              : await systemActions.adjustSystemVolume(volume.direction, volume.steps),
          )
        : `[DENIED: ${check.reason}]`
      if (signal?.aborted) {
        yield closeAutomation("Automation cancelled.", true)
        yield { type: "done" }
        return
      }
      yield { type: "agent_tool_result", tool: toolName, result }
      const failed = typeof result === "object" && result !== null && "error" in result
      const output = failed
        ? "I could not adjust the volume."
        : spotify
          ? "Spotify volume adjusted."
          : "Volume adjusted."
      yield { type: "agent_text", text: output }
      await activeHooks.onStop(failed ? "volume adjustment failed" : "volume adjusted")
      if (!failed) await rememberAgentShortcut(req, output, writeTurn)
      yield timelineAutomation(automation, output, failed ? "failed" : "done")
      yield closeAutomation(output, failed)
      yield { type: "done" }
      return
    }

    const spotifyQuery = spotifyPlaybackQuery(cleanText)
    if (spotifyQuery) {
      yield stepAutomation(automation, `Play ${spotifyQuery} on Spotify`)
      yield timelineAutomation(automation, `Play ${spotifyQuery} on Spotify`, "running")
      yield { type: "agent_tool_call", tool: "play_spotify", args: { query: spotifyQuery } }
      const check = await activeHooks.onPreToolUse("play_spotify", { query: spotifyQuery })
      const result = check.ok
        ? await activeHooks.onPostToolUse(
            "play_spotify",
            await systemActions.playSpotify(spotifyQuery, { signal }),
          )
        : `[DENIED: ${check.reason}]`
      if (signal?.aborted) {
        yield closeAutomation("Automation cancelled.", true)
        yield { type: "done" }
        return
      }
      yield { type: "agent_tool_result", tool: "play_spotify", result }
      const failed = typeof result === "object" && result !== null && "error" in result
      const output = failed
        ? `I could not play ${spotifyQuery} on Spotify.`
        : `Playing ${spotifyQuery} on Spotify.`
      yield { type: "agent_text", text: output }
      await activeHooks.onStop(failed ? "spotify playback failed" : "spotify playback started")
      if (!failed) await rememberAgentShortcut(req, output, writeTurn)
      yield timelineAutomation(automation, output, failed ? "failed" : "done")
      yield closeAutomation(output, failed)
      yield { type: "done" }
      return
    }

    const notepadReq = windowsNotepadRequest(cleanText)
    if (notepadReq) {
      const content = notepadReq.needsMemory
        ? await notepadKnownAboutMeText(req.plan)
        : notepadReq.content
      if (!content.trim()) {
        const output = "What should I write in Notepad?"
        yield waitingAutomation(automation, output, "moderate")
        yield timelineAutomation(automation, output, "waiting")
        yield { type: "agent_text", text: output }
        await activeHooks.onStop("notepad content needed")
        yield closeAutomation("Waiting for Notepad content.")
        yield { type: "done" }
        return
      }
      const args = { text: content }
      yield { type: "agent_tool_call", tool: "write_windows_notepad", args }
      const check = await activeHooks.onPreToolUse("write_windows_notepad", args)
      const result = check.ok
        ? await activeHooks.onPostToolUse(
            "write_windows_notepad",
            await systemActions.writeWindowsNotepad(content),
          )
        : `[DENIED: ${check.reason}]`
      if (signal?.aborted) {
        yield closeAutomation("Automation cancelled.", true)
        yield { type: "done" }
        return
      }
      yield { type: "agent_tool_result", tool: "write_windows_notepad", result }
      const failed = shortcutFailed(result)
      const output = failed
        ? "I opened Windows Notepad, but could not write into it."
        : notepadReq.wantsSave
          ? "I wrote it in Windows Notepad. Where should I save the file, and what should I name it?"
          : "I wrote it in Windows Notepad."
      if (!failed) pendingWindowsNotepadDraft = true
      yield { type: "agent_text", text: output }
      await activeHooks.onStop(failed ? "notepad write failed" : "notepad draft written")
      if (!failed) await rememberAgentShortcut(req, output, writeTurn)
      yield timelineAutomation(automation, output, failed ? "failed" : "done")
      yield closeAutomation(output, failed)
      yield { type: "done" }
      return
    }

    const pendingRecipient = pendingDraftRecipientRequest(cleanText, pendingWhatsAppDraft !== null)
    if (pendingRecipient && pendingWhatsAppDraft) {
      const draft = pendingWhatsAppDraft
      const args = { recipient: pendingRecipient, message: draft.message }
      yield { type: "agent_tool_call", tool: "send_whatsapp_message", args }
      const check = await activeHooks.onPreToolUse("send_whatsapp_message", args)
      const result = check.ok
        ? await activeHooks.onPostToolUse(
            "send_whatsapp_message",
            await systemActions.sendWhatsAppMessage(pendingRecipient, draft.message, {
              signal,
            }),
          )
        : `[DENIED: ${check.reason}]`
      if (signal?.aborted) {
        yield closeAutomation("Automation cancelled.", true)
        yield { type: "done" }
        return
      }
      yield { type: "agent_tool_result", tool: "send_whatsapp_message", result }
      const failed = shortcutFailed(result)
      const errText =
        failed && typeof (result as { error?: unknown }).error === "string"
          ? (result as { error: string }).error
          : null
      const output = failed
        ? (errText ?? `I could not send the reminder to ${pendingRecipient} on WhatsApp.`)
        : `Sent the reminder to ${pendingRecipient} on WhatsApp.`
      if (!failed) pendingWhatsAppDraft = null
      yield { type: "agent_text", text: output }
      await activeHooks.onStop(failed ? "whatsapp reminder send failed" : "whatsapp reminder sent")
      if (!failed) await rememberAgentShortcut(req, output, writeTurn)
      yield timelineAutomation(automation, output, failed ? "failed" : "done")
      yield closeAutomation(output, failed)
      yield { type: "done" }
      return
    }

    const whatsAppMessage = whatsAppMessageRequest(cleanText)
    if (whatsAppMessage) {
      yield { type: "agent_tool_call", tool: "send_whatsapp_message", args: whatsAppMessage }
      const check = await activeHooks.onPreToolUse("send_whatsapp_message", whatsAppMessage)
      const result = check.ok
        ? await activeHooks.onPostToolUse(
            "send_whatsapp_message",
            await systemActions.sendWhatsAppMessage(
              whatsAppMessage.recipient,
              whatsAppMessage.message,
              { signal },
            ),
          )
        : `[DENIED: ${check.reason}]`
      if (signal?.aborted) {
        yield closeAutomation("Automation cancelled.", true)
        yield { type: "done" }
        return
      }
      yield { type: "agent_tool_result", tool: "send_whatsapp_message", result }
      const failed = shortcutFailed(result)
      // On failure speak the actual reason/question (e.g. "who should I message?") so the user can
      // clarify, rather than a generic "couldn't send".
      const errText =
        failed && typeof (result as { error?: unknown }).error === "string"
          ? (result as { error: string }).error
          : null
      const output = failed
        ? (errText ??
          `I could not send "${whatsAppMessage.message}" to ${whatsAppMessage.recipient} on WhatsApp.`)
        : `Sent "${whatsAppMessage.message}" to ${whatsAppMessage.recipient} on WhatsApp.`
      yield { type: "agent_text", text: output }
      await activeHooks.onStop(failed ? "whatsapp send failed" : "whatsapp message sent")
      if (!failed) await rememberAgentShortcut(req, output, writeTurn)
      yield timelineAutomation(automation, output, failed ? "failed" : "done")
      yield closeAutomation(output, failed)
      yield { type: "done" }
      return
    }

    const reminderDraft = reminderDraftRequest(cleanText)
    if (reminderDraft) {
      pendingWhatsAppDraft = { kind: "reminder", message: reminderDraft.message }
      const output = `I wrote: "${reminderDraft.message}". Who should I send it to on WhatsApp?`
      yield waitingAutomation(automation, "Waiting for WhatsApp recipient", "moderate")
      yield timelineAutomation(automation, "Drafted WhatsApp reminder", "done")
      yield { type: "agent_text", text: output }
      await activeHooks.onStop("whatsapp reminder recipient needed")
      yield closeAutomation("Waiting for WhatsApp recipient.")
      yield { type: "done" }
      return
    }

    // Build tools only for the full agent loop (not the fast-path returns above), so a "volume up"
    // command doesn't spawn the browser MCP. Browser tools merge in behind the same safety guard.
    const mcpTools = wrapBrowserTools(await getMcpTools())
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
    // the burst is cheaper and finishes inside the model's window. The legacy
    // pipeline is single-burst-per-call (the graph owns cross-burst state), so
    // the integration lives BEFORE streamText — not between steps.
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
      yield timelineAutomation(
        automation,
        `Compressed context: ${compression.originalCount} → ${compression.compressedCount} messages (~${compression.preTokens - compression.postTokens} tokens saved)`,
        "done",
      )
    }

    const result = streamText({
      model: createModel(AGENT_PATH_MODEL),
      system,
      // Prepend prior turns so follow-up commands in the conversational act loop have context.
      messages: preCompressedMessages as unknown as Parameters<typeof streamText>[0]["messages"],
      tools,
      maxSteps: MAX_STEPS,
      abortSignal: signal,
    })

    let stepCount = 0
    // Keep a rolling tail for the onStop summary (avoid unbounded accumulation).
    let textTail = ""

    for await (const event of result.fullStream as AsyncIterable<AgentStreamEvent>) {
      switch (event.type) {
        case "text-delta":
          textTail = (textTail + event.textDelta).slice(-200)
          yield { type: "agent_text", text: event.textDelta }
          break
        case "tool-call": {
          const guard = guards.onToolCall(event.toolName, event.args as Record<string, unknown>)
          yield stepAutomation(automation, `Using ${event.toolName}`, {
            state: "executing",
            nextStep: "Review tool result",
          })
          yield timelineAutomation(
            automation,
            `Started ${event.toolName}`,
            "running",
            JSON.stringify(redactAutomationPayload(event.args)),
          )
          yield {
            type: "agent_tool_call",
            tool: event.toolName,
            args: event.args as Record<string, unknown>,
          }
          if (guard.break) {
            yield timelineAutomation(automation, guard.reason, "failed")
            yield closeAutomation(guard.reason, true)
            yield { type: "error", message: guard.reason }
            await activeHooks.onStop(guard.reason)
            return
          }
          break
        }
        case "tool-result":
          yield timelineAutomation(
            automation,
            `Finished ${event.toolName}`,
            "done",
            JSON.stringify(redactAutomationPayload(event.result)),
          )
          yield { type: "agent_tool_result", tool: event.toolName, result: event.result }
          break
        case "step-finish": {
          stepCount++
          yield stepAutomation(automation, `Agent step ${stepCount}`, {
            state: "executing",
            step: stepCount,
            maxSteps: MAX_STEPS,
          })
          yield { type: "agent_step", iteration: stepCount, max: MAX_STEPS }
          const guard = guards.onStep()
          if (guard.break) {
            yield timelineAutomation(automation, guard.reason, "failed")
            yield closeAutomation(guard.reason, true)
            yield { type: "error", message: guard.reason }
            await activeHooks.onStop(guard.reason)
            return
          }
          break
        }
        case "error":
          yield closeAutomation(
            event.error instanceof Error ? event.error.message : String(event.error),
            true,
          )
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
      // Fire compaction after each agent run; it no-ops if the session log is too short.
      // The compactor's tail also drives the skill curator on Pro/Max plans.
      compact({ plan: req.plan }).catch((err) =>
        console.warn("[yomi/agent] compaction error:", err),
      )
    }
    yield timelineAutomation(automation, summary, "done")
    yield closeAutomation(summary)
    yield { type: "done" }
  } finally {
    if (!automationClosed && !signal?.aborted) {
      opts?.emit?.(failAutomation(automation, "Automation ended before completion."))
    }
    // Always detach the act emitter so a later run doesn't write to a dead stream.
    if (opts?.emit) setActEmitter(null)
  }
}
