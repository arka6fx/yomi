import type { CoreMessage } from "ai"
import type { GraphDeps } from "../deps.js"
import type { GraphState } from "../state.js"
import { recallKnowledge } from "../../automation/knowledge.js"

// Recovery: analyze the failure, append a corrective instruction, and route back to Execution.
// recoveryCount guards against loops; escalation (>= MAX) is decided by the Validation edge.
// Self-healing: reuse a previously-successful fix for a similar error, and stash the applied
// strategy so Completion can persist it if this attempt ends up validating.
export function makeRecoveryNode(deps: GraphDeps) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    const next = state.recoveryCount + 1
    const reason = state.lastError ?? "previous attempt did not validate"
    deps.bridge.recovering(reason)
    deps.bridge.timeline(`Recovering (attempt ${next}): ${reason}`, "running")

    // Consult the Knowledge Base for a fix that worked before on a similar task.
    const prior = recallKnowledge(state.agentId, state.goal).recoveries[0]
    let strategy =
      "Re-check the current screen/app state and try a different approach to finish the task."
    if (prior) {
      strategy = `A previously successful fix here was: ${prior.strategy}. ${strategy}`
      deps.bridge.timeline("Reusing a learned recovery", "running", prior.strategy)
    }

    const corrective: CoreMessage = {
      role: "user",
      content: `The previous attempt failed: ${reason}. ${strategy}`,
    }
    return {
      recoveryCount: next,
      lastError: null,
      recoveryError: reason,
      recoveryStrategy: strategy,
      messages: [corrective],
      agentStatus: "recovering",
    }
  }
}
