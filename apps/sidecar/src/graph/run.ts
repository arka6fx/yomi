import type { AgentQueryRequest, SseEvent } from "@yomi/shared"
import { agentPipeline } from "../pipeline/agent.js"
import type { Hooks } from "../harness/hooks.js"

export interface RunGraphOptions {
  emit?: (e: SseEvent) => void
  hooks?: Hooks
  writeSessionTurn?: unknown
  signal?: AbortSignal
  requestApproval?: (label: string, reason: string) => Promise<boolean>
}

export async function* runGraph(
  req: AgentQueryRequest,
  opts?: RunGraphOptions,
): AsyncGenerator<SseEvent> {
  for await (const event of agentPipeline(req, {
    emit: opts?.emit,
    hooks: opts?.hooks,
    signal: opts?.signal,
  })) {
    yield event
  }
}
