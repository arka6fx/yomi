import type { AgentQueryRequest, SseEvent } from "@yomi/shared"
import { hooks, type Hooks } from "../harness/hooks.js"
import { LoopGuards } from "../harness/guards.js"
import { createModel } from "../pipeline/model.js"
import { writeSessionTurn } from "../memory/subsystem.js"
import { setActEmitter, requestConfirmation } from "../uia/act-bus.js"
import { uia } from "../uia/client.js"
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
  const background = req.background ?? false

  const automation = startAutomationRun(req.text)
  const channel = createChannel<SseEvent>()
  const emit = (e: SseEvent) => channel.push(e)
  const bridge = new EventBridge(automation, emit)

  // Initial lifecycle events (mirror legacy ordering).
  for (const e of automation.events) emit(e)
  emit(previewAutomation(automation))
  bridge.timeline("Prepared automation preview", "planned")

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
    toolsPromise: buildAgentToolSet({ screenshotB64: req.screenshot_b64, background }, activeHooks),
    background,
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
      { taskId: automation.run.id, goal: req.text, background, plan: req.plan },
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
