import type { CoreMessage } from "ai"
import type { GraphDeps } from "../deps.js"
import type { GraphState } from "../state.js"
import { recallKnowledge } from "../../automation/knowledge.js"

const ERROR_CLASS_HINTS: Record<string, string> = {
  context_overflow:
    "The conversation context was too long. The context has been compressed — try a more focused, direct approach.",
  content_policy:
    "This action was blocked by a content policy filter. Rephrase or modify the request to avoid the flagged content.",
  auth:
    "Authentication failed. Check that the relevant integration is still connected and the token is valid.",
  timeout:
    "The previous attempt timed out. Try a simpler or more direct approach with fewer steps.",
}

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

    const classHint = ERROR_CLASS_HINTS[state.errorClass] ?? null
    let strategy = classHint
      ?? "Re-check the current screen/app state and try a different approach to finish the task."
    if (prior && !classHint) {
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
      errorClass: "unknown",
      recoveryError: reason,
      recoveryStrategy: strategy,
      messages: [corrective],
      agentStatus: "recovering",
    }
  }
}
