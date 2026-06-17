import type { AgentQueryRequest, SseEvent } from "@yomi/shared"
import { hooks, type Hooks } from "../harness/hooks.js"
import { LoopGuards } from "../harness/guards.js"
import { createModel } from "../pipeline/model.js"
import { synthesize, resolveTts } from "../pipeline/tts.js"
import { writeSessionTurn } from "../memory/subsystem.js"
// Desktop automation imports — will provide later.
// import { setActEmitter, requestConfirmation } from "../uia/act-bus.js"
// import { uia } from "../uia/client.js"
// import {
//   adjustSystemVolume,
//   adjustSpotifyVolume,
//   appendWindowsNotepad,
//   controlSpotifyPlayback,
//   openUserChrome,
//   playSpotify,
//   saveWindowsNotepadAs,
//   sendWhatsAppMessage,
//   writeWindowsNotepad,
// } from "../tools/system.js"
// import {
//   playbackControl,
//   spotifyPlaybackQuery,
//   volumeAction,
//   whatsAppMessageRequest,
//   reminderDraftRequest,
//   pendingDraftRecipientRequest,
//   stripDetachedPhrases,
// } from "../pipeline/shortcuts.js"
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

// Desktop automation shortcut helpers — will provide later.
// let pendingWhatsAppDraft: { kind: "reminder"; message: string } | null = null

// export function __resetGraphShortcutStateForTest(): void {
//   pendingWhatsAppDraft = null
// }

// function notepadWriteText(text: string): string | null {
//   if (!/\bnotepad\b/i.test(text)) return null
//   const match =
//     text.match(
//       /\b(?:write|type|put|draft)\b(?:\s+(?:this|the following))*[:\s]+(.+?)\s+(?:in|into|on)\s+(?:the\s+)?(?:windows\s+)?notepad\b/i,
//     ) ??
//     text.match(
//       /\b(?:write|type|put|draft)\b(?:\s+(?:this|the following|in notepad|into notepad))*[:\s]+(.+)$/i,
//     )
//   const content = match?.[1]?.trim().replace(/^["'`]|["'`]$/g, "")
//   return content || null
// }

// function notepadAppendText(text: string): string | null {
//   if (!/\b(notepad|txt|text\s+file|file|document)\b/i.test(text)) return null
//   if (!/\b(add|append|insert|write|type|put)\b/i.test(text)) return null
//   const match =
//     text.match(
//       /\b(?:add|append|insert|write|type|put)\s+(.+?)\s+(?:to|into|in|inside|at the end of)\s+(?:the\s+)?(?:open(?:ed)?\s+)?(?:notepad|txt|text\s+file|file|document)\b/i,
//     ) ??
//     text.match(
//       /\b(?:to|into|in|inside)\s+(?:the\s+)?(?:open(?:ed)?\s+)?(?:notepad|txt|text\s+file|file|document)\s+(?:add|append|insert|write|type|put)\s+(.+)$/i,
//     )
//   const content = match?.[1]?.trim().replace(/^["'`]|["'`]$/g, "")
//   return content || null
// }

// function notepadSavePath(text: string): string | null {
//   if (!/\b(save|store)\b/i.test(text)) return null
//   if (!/\b(notepad|txt|text\s+file|file|document|it|this|that)\b/i.test(text)) return null
//   const match =
//     text.match(
//       /\b(?:save|store)\s+(?:this|that|the)?\s*(?:open(?:ed)?\s+)?(?:notepad|txt|text\s+file|file|document)\s+(?:as|to|at|in)\s+(.+)$/i,
//     ) ??
//     text.match(
//       /\b(?:save|store)\s+(?:the\s+)?(?:notepad|txt|text\s+file|file|document|it|this|that)?\s*(?:file\s*)?(?:as|to|at|in)\s+(.+)$/i,
//     ) ??
//     text.match(/\b(?:as|to|at|in)\s+(.+?)\s+(?:save|store)\b/i)
//   const path = match?.[1]?.trim().replace(/^["'`]|["'`]$/g, "")
//   return path || null
// }

// function userChromeTarget(text: string): string | null {
//   if (!/\b(chrome|google\s+chrome|desktop(?:'s)?\s+google\s+chrome|browser)\b/i.test(text))
//     return null
//   if (!/\b(open|go to|navigate|search|look up|visit)\b/i.test(text)) return null
//   const match =
//     text.match(
//       /\b(?:open|launch|start)\s+(?:my\s+|user(?:'s)?\s+|desktop(?:'s)?\s+)?(?:google\s+)?(?:chrome|browser)(?:\s+(?:and|then))?\s*(?:go to|navigate to|open|visit|search for|look up)?\s*(.*)$/i,
//     ) ??
//     text.match(
//       /\b(?:go to|navigate to|visit|open|search for|look up)\s+(.+?)\s+(?:in|on|using)\s+(?:my\s+|user(?:'s)?\s+|desktop(?:'s)?\s+)?(?:google\s+)?(?:chrome|browser)\b/i,
//     )
//   const target = match?.[1]?.trim().replace(/^["'`]|["'`]$/g, "")
//   return target ?? ""
// }

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

  // Desktop automation shortcut blocks — will provide later.
  // (chrome, notepad, spotify, volume, whatsapp shortcuts removed)

  // Per-tool act-bus confirmations — will provide later.
  // if (emitExternal) {
  //   setActEmitter((event) => {
  //     if (event.type === "act_proposed") {
  //       emit(waitingAutomation(automation, event.label, "dangerous"))
  //       emit(timelineAutomation(automation, `Waiting for approval: ${event.label}`, "waiting"))
  //     } else if (event.type === "act_result") {
  //       emit(
  //         timelineAutomation(automation, event.label, event.ok ? "done" : "failed", event.detail),
  //       )
  //     }
  //     emit(event)
  //   })
  // }

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
    // uia, // will provide later
    writeTurn,
    requestApproval: opts?.requestApproval ?? (async () => true),
    markClosed: () => {
      closed = true
    },
  }
  // Avoid an unhandled rejection if the MCP/tool build fails before Execution awaits it.
  deps.toolsPromise.catch(() => undefined)

  // Superseded before we started — exit quietly (desktop barge-in).
  if (signal?.aborted) {
    // if (emitExternal) setActEmitter(null) // will provide later
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
      // if (emitExternal) setActEmitter(null) // will provide later
      channel.close()
    })

  const ttsEnabled = req.tts !== false && resolveTts() !== "none"
  let graphFullText = ""

  try {
    for await (const event of channel.iterate()) {
      if (ttsEnabled && event.type === "agent_text") graphFullText += event.text
      if (event.type === "done" && ttsEnabled && graphFullText.trim()) {
        try {
          const chunks: Uint8Array[] = []
          for await (const audio of synthesize(graphFullText.trim())) chunks.push(audio)
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
          console.warn("[yomi/graph] TTS synthesis failed:", err instanceof Error ? err.message : String(err))
          yield { type: "tts_error", message: "Voice synthesis failed. Text response is still available." }
        }
      }
      yield event
    }
  } finally {
    await runPromise
  }
}
