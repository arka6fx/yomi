import type { AgentQueryRequest, SseEvent } from "@yomi/shared"
import { hooks, type Hooks } from "../harness/hooks.js"
import { LoopGuards } from "../harness/guards.js"
import { createModel } from "../pipeline/model.js"
import { writeSessionTurn } from "../memory/subsystem.js"
import { setActEmitter, requestConfirmation } from "../uia/act-bus.js"
import { uia } from "../uia/client.js"
import {
  adjustSystemVolume,
  adjustSpotifyVolume,
  appendWindowsNotepad,
  controlSpotifyPlayback,
  openUserChrome,
  playSpotify,
  saveWindowsNotepadAs,
  sendWhatsAppMessage,
  writeWindowsNotepad,
} from "../tools/system.js"
import {
  playbackControl,
  spotifyPlaybackQuery,
  volumeAction,
  whatsAppMessageRequest,
  reminderDraftRequest,
  pendingDraftRecipientRequest,
  stripDetachedPhrases,
} from "../pipeline/shortcuts.js"
import {
  failAutomation,
  previewAutomation,
  startAutomationRun,
  timelineAutomation,
  waitingAutomation,
} from "../automation/runs.js"
import { buildGraph } from "./graph.js"
import { EventBridge } from "./events.js"
import { buildAgentToolSet } from "./tools/adapter.js"
import type { GraphDeps, WriteSessionTurn } from "./deps.js"

const RECURSION_LIMIT = 50

let pendingWhatsAppDraft: { kind: "reminder"; message: string } | null = null

export function __resetGraphShortcutStateForTest(): void {
  pendingWhatsAppDraft = null
}

function notepadWriteText(text: string): string | null {
  if (!/\bnotepad\b/i.test(text)) return null
  const match =
    text.match(
      /\b(?:write|type|put|draft)\b(?:\s+(?:this|the following))*[:\s]+(.+?)\s+(?:in|into|on)\s+(?:the\s+)?(?:windows\s+)?notepad\b/i,
    ) ??
    text.match(
      /\b(?:write|type|put|draft)\b(?:\s+(?:this|the following|in notepad|into notepad))*[:\s]+(.+)$/i,
    )
  const content = match?.[1]?.trim().replace(/^["'`]|["'`]$/g, "")
  return content || null
}

function notepadAppendText(text: string): string | null {
  if (!/\b(notepad|txt|text\s+file|file|document)\b/i.test(text)) return null
  if (!/\b(add|append|insert|write|type|put)\b/i.test(text)) return null
  const match =
    text.match(
      /\b(?:add|append|insert|write|type|put)\s+(.+?)\s+(?:to|into|in|inside|at the end of)\s+(?:the\s+)?(?:open(?:ed)?\s+)?(?:notepad|txt|text\s+file|file|document)\b/i,
    ) ??
    text.match(
      /\b(?:to|into|in|inside)\s+(?:the\s+)?(?:open(?:ed)?\s+)?(?:notepad|txt|text\s+file|file|document)\s+(?:add|append|insert|write|type|put)\s+(.+)$/i,
    )
  const content = match?.[1]?.trim().replace(/^["'`]|["'`]$/g, "")
  return content || null
}

function notepadSavePath(text: string): string | null {
  if (!/\b(save|store)\b/i.test(text)) return null
  if (!/\b(notepad|txt|text\s+file|file|document|it|this|that)\b/i.test(text)) return null
  const match =
    text.match(
      /\b(?:save|store)\s+(?:this|that|the)?\s*(?:open(?:ed)?\s+)?(?:notepad|txt|text\s+file|file|document)\s+(?:as|to|at|in)\s+(.+)$/i,
    ) ??
    text.match(
      /\b(?:save|store)\s+(?:the\s+)?(?:notepad|txt|text\s+file|file|document|it|this|that)?\s*(?:file\s*)?(?:as|to|at|in)\s+(.+)$/i,
    ) ??
    text.match(/\b(?:as|to|at|in)\s+(.+?)\s+(?:save|store)\b/i)
  const path = match?.[1]?.trim().replace(/^["'`]|["'`]$/g, "")
  return path || null
}

function userChromeTarget(text: string): string | null {
  if (!/\b(chrome|google\s+chrome|desktop(?:'s)?\s+google\s+chrome|browser)\b/i.test(text))
    return null
  if (!/\b(open|go to|navigate|search|look up|visit)\b/i.test(text)) return null
  const match =
    text.match(
      /\b(?:open|launch|start)\s+(?:my\s+|user(?:'s)?\s+|desktop(?:'s)?\s+)?(?:google\s+)?(?:chrome|browser)(?:\s+(?:and|then))?\s*(?:go to|navigate to|open|visit|search for|look up)?\s*(.*)$/i,
    ) ??
    text.match(
      /\b(?:go to|navigate to|visit|open|search for|look up)\s+(.+?)\s+(?:in|on|using)\s+(?:my\s+|user(?:'s)?\s+|desktop(?:'s)?\s+)?(?:google\s+)?(?:chrome|browser)\b/i,
    )
  const target = match?.[1]?.trim().replace(/^["'`]|["'`]$/g, "")
  return target ?? ""
}

export interface RunGraphOptions {
  emit?: (e: SseEvent) => void
  hooks?: Hooks
  writeSessionTurn?: WriteSessionTurn
  signal?: AbortSignal
  // Injectable coarse-approval resolver (tests). Defaults to the act-bus confirmation round-trip.
  requestApproval?: (label: string, reason: string) => Promise<boolean>
}

// Minimal single-consumer async channel: nodes push SseEvents via deps.emit; runGraph drains.
function createChannel<T>() {
  const buffer: T[] = []
  let waiting: ((r: IteratorResult<T>) => void) | null = null
  let closed = false
  return {
    push(v: T) {
      if (closed) return
      if (waiting) {
        const w = waiting
        waiting = null
        w({ value: v, done: false })
      } else buffer.push(v)
    },
    close() {
      closed = true
      if (waiting) {
        const w = waiting
        waiting = null
        w({ value: undefined as never, done: true })
      }
    },
    async *iterate(): AsyncGenerator<T> {
      while (true) {
        if (buffer.length) {
          yield buffer.shift() as T
          continue
        }
        if (closed) return
        const r = await new Promise<IteratorResult<T>>((res) => (waiting = res))
        if (r.done) return
        yield r.value
      }
    },
  }
}

// Agent-path orchestrator façade. Same signature/stream contract as the legacy agentPipeline, so
// index.ts and the streamSSE glue are unchanged. Drives the LangGraph StateGraph and bridges node
// lifecycle to the existing automation_* / agent_* SSE events.
export async function* runGraph(
  req: AgentQueryRequest,
  opts?: RunGraphOptions,
): AsyncGenerator<SseEvent> {
  const emitExternal = opts?.emit
  const signal = opts?.signal
  const activeHooks = opts?.hooks ?? hooks
  const writeTurn = opts?.writeSessionTurn ?? writeSessionTurn

  const automation = startAutomationRun(req.text)
  const channel = createChannel<SseEvent>()
  const emit = (e: SseEvent) => channel.push(e)
  const bridge = new EventBridge(automation, emit)

  // Initial lifecycle events (mirror legacy ordering).
  for (const e of automation.events) emit(e)
  emit(previewAutomation(automation))
  bridge.timeline("Prepared automation preview", "planned")

  const chromeTarget = userChromeTarget(req.text)
  if (chromeTarget !== null) {
    const args = { target: chromeTarget }
    bridge.step("Opening user Chrome", { state: "executing", step: 1, maxSteps: 1 })
    bridge.timeline("Started open_user_chrome", "running", JSON.stringify(args))
    bridge.raw({ type: "agent_tool_call", tool: "open_user_chrome", args })
    const check = await activeHooks.onPreToolUse("open_user_chrome", args)
    const result = check.ok
      ? await activeHooks.onPostToolUse("open_user_chrome", await openUserChrome(chromeTarget))
      : { error: `[DENIED: ${check.reason}]` }
    const failed = typeof result === "object" && result !== null && "error" in result
    bridge.raw({ type: "agent_tool_result", tool: "open_user_chrome", result })
    bridge.timeline("Finished open_user_chrome", failed ? "failed" : "done", JSON.stringify(result))
    const summary = failed ? "I could not open Chrome." : "I opened it in your Chrome."
    bridge.raw({ type: "agent_text", text: summary })
    if (failed) bridge.fail(summary)
    else {
      bridge.timeline(summary, "done")
      bridge.complete(summary)
    }
    await activeHooks.onStop(summary)
    emit({ type: "done" })
    channel.close()
    for await (const event of channel.iterate()) yield event
    return
  }

  const savePath = notepadSavePath(req.text)
  if (savePath) {
    const args = { path: savePath }
    bridge.step("Saving Notepad file", { state: "executing", step: 1, maxSteps: 1 })
    bridge.timeline("Started save_windows_notepad_as", "running", JSON.stringify(args))
    bridge.raw({ type: "agent_tool_call", tool: "save_windows_notepad_as", args })
    const check = await activeHooks.onPreToolUse("save_windows_notepad_as", args)
    const result = check.ok
      ? await activeHooks.onPostToolUse(
          "save_windows_notepad_as",
          await saveWindowsNotepadAs(savePath),
        )
      : { error: `[DENIED: ${check.reason}]` }
    const failed = typeof result === "object" && result !== null && "error" in result
    bridge.raw({ type: "agent_tool_result", tool: "save_windows_notepad_as", result })
    bridge.timeline(
      "Finished save_windows_notepad_as",
      failed ? "failed" : "done",
      JSON.stringify(result),
    )
    const savedPath =
      typeof result === "object" && result !== null && "path" in result
        ? String((result as { path: unknown }).path)
        : savePath
    const summary = failed
      ? "I could not save the Notepad file."
      : `I saved the Notepad file to ${savedPath}.`
    bridge.raw({ type: "agent_text", text: summary })
    if (failed) bridge.fail(summary)
    else {
      bridge.timeline(summary, "done")
      bridge.complete(summary)
    }
    await activeHooks.onStop(summary)
    emit({ type: "done" })
    channel.close()
    for await (const event of channel.iterate()) yield event
    return
  }

  const notepadText = notepadWriteText(req.text)
  if (notepadText) {
    const args = { text: notepadText }
    bridge.step("Writing to Notepad", { state: "executing", step: 1, maxSteps: 1 })
    bridge.timeline("Started write_windows_notepad", "running", JSON.stringify(args))
    bridge.raw({ type: "agent_tool_call", tool: "write_windows_notepad", args })
    const check = await activeHooks.onPreToolUse("write_windows_notepad", args)
    const result = check.ok
      ? await activeHooks.onPostToolUse(
          "write_windows_notepad",
          await writeWindowsNotepad(notepadText),
        )
      : { error: `[DENIED: ${check.reason}]` }
    const failed = typeof result === "object" && result !== null && "error" in result
    bridge.raw({ type: "agent_tool_result", tool: "write_windows_notepad", result })
    bridge.timeline(
      "Finished write_windows_notepad",
      failed ? "failed" : "done",
      JSON.stringify(result),
    )
    const summary = failed
      ? "I opened Notepad, but could not write into it."
      : "I wrote it in Windows Notepad."
    bridge.raw({ type: "agent_text", text: summary })
    if (failed) bridge.fail(summary)
    else {
      bridge.timeline(summary, "done")
      bridge.complete(summary)
    }
    await activeHooks.onStop(summary)
    emit({ type: "done" })
    channel.close()
    for await (const event of channel.iterate()) yield event
    return
  }

  const appendText = notepadAppendText(req.text)
  if (appendText) {
    const args = { text: appendText }
    bridge.step("Appending to Notepad", { state: "executing", step: 1, maxSteps: 1 })
    bridge.timeline("Started append_windows_notepad", "running", JSON.stringify(args))
    bridge.raw({ type: "agent_tool_call", tool: "append_windows_notepad", args })
    const check = await activeHooks.onPreToolUse("append_windows_notepad", args)
    const result = check.ok
      ? await activeHooks.onPostToolUse(
          "append_windows_notepad",
          await appendWindowsNotepad(appendText),
        )
      : { error: `[DENIED: ${check.reason}]` }
    const failed = typeof result === "object" && result !== null && "error" in result
    bridge.raw({ type: "agent_tool_result", tool: "append_windows_notepad", result })
    bridge.timeline(
      "Finished append_windows_notepad",
      failed ? "failed" : "done",
      JSON.stringify(result),
    )
    const summary = failed ? "I could not append text to Notepad." : "I added the text to Notepad."
    bridge.raw({ type: "agent_text", text: summary })
    if (failed) bridge.fail(summary)
    else {
      bridge.timeline(summary, "done")
      bridge.complete(summary)
    }
    await activeHooks.onStop(summary)
    emit({ type: "done" })
    channel.close()
    for await (const event of channel.iterate()) yield event
    return
  }

  const cleanText = stripDetachedPhrases(req.text)

  const control = playbackControl(cleanText)
  if (control) {
    const args = { action: control }
    bridge.step("Control Spotify playback", { state: "executing", step: 1, maxSteps: 1 })
    bridge.timeline("Started control_spotify", "running", JSON.stringify(args))
    bridge.raw({ type: "agent_tool_call", tool: "control_spotify", args })
    const check = await activeHooks.onPreToolUse("control_spotify", args)
    const result = check.ok
      ? await activeHooks.onPostToolUse("control_spotify", await controlSpotifyPlayback(control))
      : { error: `[DENIED: ${check.reason}]` }
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
    const summary = failed ? "I could not control Spotify playback." : `${verb}.`
    bridge.raw({ type: "agent_tool_result", tool: "control_spotify", result })
    bridge.timeline("Finished control_spotify", failed ? "failed" : "done", JSON.stringify(result))
    bridge.raw({ type: "agent_text", text: summary })
    if (failed) bridge.fail(summary)
    else {
      bridge.timeline(summary, "done")
      bridge.complete(summary)
    }
    await activeHooks.onStop(summary)
    emit({ type: "done" })
    channel.close()
    for await (const event of channel.iterate()) yield event
    return
  }

  const volume = volumeAction(cleanText)
  if (volume) {
    const spotify = volume.target === "spotify"
    const toolName = spotify ? "adjust_spotify_volume" : "adjust_volume"
    const args = { direction: volume.direction, steps: volume.steps }
    bridge.step(spotify ? "Adjust Spotify volume" : "Adjust system volume", {
      state: "executing",
      step: 1,
      maxSteps: 1,
    })
    bridge.timeline(`Started ${toolName}`, "running", JSON.stringify(args))
    bridge.raw({ type: "agent_tool_call", tool: toolName, args })
    const check = await activeHooks.onPreToolUse(toolName, args)
    const result = check.ok
      ? await activeHooks.onPostToolUse(
          toolName,
          spotify
            ? await adjustSpotifyVolume(volume.direction, volume.steps, { signal })
            : await adjustSystemVolume(volume.direction, volume.steps),
        )
      : { error: `[DENIED: ${check.reason}]` }
    if (signal?.aborted) {
      emit({ type: "done" })
      channel.close()
      for await (const event of channel.iterate()) yield event
      return
    }
    const failed = typeof result === "object" && result !== null && "error" in result
    const summary = failed
      ? "I could not adjust the volume."
      : spotify
        ? "Spotify volume adjusted."
        : "Volume adjusted."
    bridge.raw({ type: "agent_tool_result", tool: toolName, result })
    bridge.timeline(`Finished ${toolName}`, failed ? "failed" : "done", JSON.stringify(result))
    bridge.raw({ type: "agent_text", text: summary })
    if (failed) bridge.fail(summary)
    else {
      bridge.timeline(summary, "done")
      bridge.complete(summary)
    }
    await activeHooks.onStop(summary)
    emit({ type: "done" })
    channel.close()
    for await (const event of channel.iterate()) yield event
    return
  }

  const spotifyQuery = spotifyPlaybackQuery(cleanText)
  if (spotifyQuery) {
    const args = { query: spotifyQuery }
    bridge.step(`Play ${spotifyQuery} on Spotify`, { state: "executing", step: 1, maxSteps: 1 })
    bridge.timeline("Started play_spotify", "running", JSON.stringify(args))
    bridge.raw({ type: "agent_tool_call", tool: "play_spotify", args })
    const check = await activeHooks.onPreToolUse("play_spotify", args)
    const result = check.ok
      ? await activeHooks.onPostToolUse("play_spotify", await playSpotify(spotifyQuery, { signal }))
      : { error: `[DENIED: ${check.reason}]` }
    if (signal?.aborted) {
      emit({ type: "done" })
      channel.close()
      for await (const event of channel.iterate()) yield event
      return
    }
    const failed = typeof result === "object" && result !== null && "error" in result
    const summary = failed
      ? `I could not play ${spotifyQuery} on Spotify.`
      : `Playing ${spotifyQuery} on Spotify.`
    bridge.raw({ type: "agent_tool_result", tool: "play_spotify", result })
    bridge.timeline("Finished play_spotify", failed ? "failed" : "done", JSON.stringify(result))
    bridge.raw({ type: "agent_text", text: summary })
    if (failed) bridge.fail(summary)
    else {
      bridge.timeline(summary, "done")
      bridge.complete(summary)
    }
    await activeHooks.onStop(summary)
    emit({ type: "done" })
    channel.close()
    for await (const event of channel.iterate()) yield event
    return
  }

  const pendingRecipient = pendingDraftRecipientRequest(cleanText, pendingWhatsAppDraft !== null)
  if (pendingRecipient && pendingWhatsAppDraft) {
    const draft = pendingWhatsAppDraft
    const args = { recipient: pendingRecipient, message: draft.message }
    bridge.step("Send WhatsApp reminder", { state: "executing", step: 1, maxSteps: 1 })
    bridge.timeline("Started send_whatsapp_message", "running", JSON.stringify(args))
    bridge.raw({ type: "agent_tool_call", tool: "send_whatsapp_message", args })
    const check = await activeHooks.onPreToolUse("send_whatsapp_message", args)
    const result = check.ok
      ? await activeHooks.onPostToolUse(
          "send_whatsapp_message",
          await sendWhatsAppMessage(pendingRecipient, draft.message, { signal }),
        )
      : { error: `[DENIED: ${check.reason}]` }
    if (signal?.aborted) {
      emit({ type: "done" })
      channel.close()
      for await (const event of channel.iterate()) yield event
      return
    }
    const failed = typeof result === "object" && result !== null && "error" in result
    const errText =
      failed && typeof (result as { error?: unknown }).error === "string"
        ? (result as { error: string }).error
        : null
    const summary = failed
      ? (errText ?? `I could not send the reminder to ${pendingRecipient} on WhatsApp.`)
      : `Sent the reminder to ${pendingRecipient} on WhatsApp.`
    if (!failed) pendingWhatsAppDraft = null
    bridge.raw({ type: "agent_tool_result", tool: "send_whatsapp_message", result })
    bridge.timeline(
      "Finished send_whatsapp_message",
      failed ? "failed" : "done",
      JSON.stringify(result),
    )
    bridge.raw({ type: "agent_text", text: summary })
    if (failed) bridge.fail(summary)
    else {
      bridge.timeline(summary, "done")
      bridge.complete(summary)
    }
    await activeHooks.onStop(summary)
    emit({ type: "done" })
    channel.close()
    for await (const event of channel.iterate()) yield event
    return
  }

  const whatsAppMessage = whatsAppMessageRequest(cleanText)
  if (whatsAppMessage) {
    const args = whatsAppMessage
    bridge.step("Send WhatsApp message", { state: "executing", step: 1, maxSteps: 1 })
    bridge.timeline("Started send_whatsapp_message", "running", JSON.stringify(args))
    bridge.raw({ type: "agent_tool_call", tool: "send_whatsapp_message", args })
    const check = await activeHooks.onPreToolUse("send_whatsapp_message", args)
    const result = check.ok
      ? await activeHooks.onPostToolUse(
          "send_whatsapp_message",
          await sendWhatsAppMessage(whatsAppMessage.recipient, whatsAppMessage.message, { signal }),
        )
      : { error: `[DENIED: ${check.reason}]` }
    if (signal?.aborted) {
      emit({ type: "done" })
      channel.close()
      for await (const event of channel.iterate()) yield event
      return
    }
    const failed = typeof result === "object" && result !== null && "error" in result
    const errText =
      failed && typeof (result as { error?: unknown }).error === "string"
        ? (result as { error: string }).error
        : null
    const summary = failed
      ? (errText ??
        `I could not send "${whatsAppMessage.message}" to ${whatsAppMessage.recipient} on WhatsApp.`)
      : `Sent "${whatsAppMessage.message}" to ${whatsAppMessage.recipient} on WhatsApp.`
    bridge.raw({ type: "agent_tool_result", tool: "send_whatsapp_message", result })
    bridge.timeline(
      "Finished send_whatsapp_message",
      failed ? "failed" : "done",
      JSON.stringify(result),
    )
    bridge.raw({ type: "agent_text", text: summary })
    if (failed) bridge.fail(summary)
    else {
      bridge.timeline(summary, "done")
      bridge.complete(summary)
    }
    await activeHooks.onStop(summary)
    emit({ type: "done" })
    channel.close()
    for await (const event of channel.iterate()) yield event
    return
  }

  const reminderDraft = reminderDraftRequest(cleanText)
  if (reminderDraft) {
    pendingWhatsAppDraft = { kind: "reminder", message: reminderDraft.message }
    const summary = `I wrote: "${reminderDraft.message}". Who should I send it to on WhatsApp?`
    bridge.waiting("Waiting for WhatsApp recipient", "moderate")
    bridge.timeline("Drafted WhatsApp reminder", "done")
    bridge.raw({ type: "agent_text", text: summary })
    await activeHooks.onStop("whatsapp reminder recipient needed")
    bridge.complete("Waiting for WhatsApp recipient.")
    emit({ type: "done" })
    channel.close()
    for await (const event of channel.iterate()) yield event
    return
  }

  // Per-tool act-bus confirmations surface as waiting/timeline + the raw act_* event on the stream.
  if (emitExternal) {
    setActEmitter((event) => {
      if (event.type === "act_proposed") {
        emit(waitingAutomation(automation, event.label, "dangerous"))
        emit(timelineAutomation(automation, `Waiting for approval: ${event.label}`, "waiting"))
      } else if (event.type === "act_result") {
        emit(
          timelineAutomation(automation, event.label, event.ok ? "done" : "failed", event.detail),
        )
      }
      emit(event)
    })
  }

  let closed = false
  const deps: GraphDeps = {
    req,
    emit,
    signal,
    hooks: activeHooks,
    guards: new LoopGuards(),
    automation,
    bridge,
    modelFactory: createModel,
    toolsPromise: buildAgentToolSet(
      { screenshotB64: req.screenshot_b64, plan: req.plan },
      activeHooks,
    ),
    uia,
    writeTurn,
    requestApproval:
      opts?.requestApproval ??
      ((label, reason) =>
        requestConfirmation({ kind: "invoke", ref: "graph-approval" }, label, reason)),
    markClosed: () => {
      closed = true
    },
  }
  // Avoid an unhandled rejection if the MCP/tool build fails before Execution awaits it.
  deps.toolsPromise.catch(() => undefined)

  // Superseded before we started — exit quietly (desktop barge-in).
  if (signal?.aborted) {
    if (emitExternal) setActEmitter(null)
    yield { type: "done" }
    return
  }

  const graph = buildGraph(deps)
  const runPromise = graph
    .invoke(
      { taskId: automation.run.id, goal: req.text, plan: req.plan },
      { recursionLimit: RECURSION_LIMIT },
    )
    .then(() => {
      if (!closed && !signal?.aborted)
        emit(failAutomation(automation, "Automation ended before completion."))
      emit({ type: "done" })
    })
    .catch((err: unknown) => {
      if (signal?.aborted) {
        emit({ type: "done" })
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      if (!closed) emit(failAutomation(automation, message))
      emit({ type: "error", message })
      emit({ type: "done" })
    })
    .finally(() => {
      if (emitExternal) setActEmitter(null)
      channel.close()
    })

  try {
    for await (const event of channel.iterate()) yield event
  } finally {
    await runPromise
  }
}
