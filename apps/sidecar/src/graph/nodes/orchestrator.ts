import type { CoreMessage } from "ai"
import type { GraphDeps } from "../deps.js"
import type { GraphState } from "../state.js"

// MainOrchestrator: receive the task, seed the conversation (history + user turn), set status.
// Intent analysis is already done upstream by the router; phase 1 always proceeds to Planning.
export function makeOrchestratorNode(deps: GraphDeps) {
  return async (_state: GraphState): Promise<Partial<GraphState>> => {
    deps.bridge.step("Analyzing request", { state: "thinking" })
    const messages: CoreMessage[] = [
      ...(deps.req.history ?? []).map((h) => ({ role: h.role, content: h.text }) as CoreMessage),
      { role: "user", content: deps.req.text },
    ]
    return { messages, agentStatus: "thinking", currentStep: "Analyzing request" }
  }
}
