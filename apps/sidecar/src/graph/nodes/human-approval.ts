import { graphApprovalGate, type GraphDeps } from "../deps.js"
import type { GraphState } from "../state.js"

// HumanApproval: pause execution for a coarse "run this automation?" approval card.
// Off by default (GRAPH_APPROVAL_GATE) because risky tools (e.g. send_whatsapp_message) already
// raise their own fine-grained act-bus confirmation inside Execution — enabling both double-prompts.
// Phase 2 swaps deps.requestApproval for a durable LangGraph interrupt()+checkpointer.
export function makeHumanApprovalNode(deps: GraphDeps) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    if (!graphApprovalGate()) {
      // Gate disabled: defer to per-tool confirmations during Execution.
      return { permissionStatus: "granted" }
    }
    deps.bridge.step("Awaiting approval", { state: "needs_approval" })
    deps.bridge.waiting(`Approve automation: ${state.goal}`, "dangerous")
    deps.bridge.timeline(`Waiting for approval: ${state.goal}`, "waiting")
    const approved = await deps.requestApproval(
      `Run: ${state.goal}`,
      "This automation may take a sensitive action.",
    )
    deps.bridge.timeline(approved ? "Approved" : "Denied", approved ? "done" : "failed")
    return {
      permissionStatus: approved ? "granted" : "denied",
      agentStatus: approved ? "executing" : "failed",
    }
  }
}
