import { compact } from "../../memory/compactor.js"
import { goalKeyOf, recordRecovery, recordWorkflow } from "../../automation/knowledge.js"
import { memoryEnabled, type GraphDeps } from "../deps.js"
import type { GraphState } from "../state.js"

// Completion: store the workflow outcome, update memory + knowledge base, and emit the terminal
// automation event. Records every run (success or failure) and promotes a recovery that ended in
// success to reusable knowledge.
export function makeCompletionNode(deps: GraphDeps) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    const failed =
      state.failed || state.validationStatus === "failed" || state.permissionStatus === "denied"

    let summary: string
    if (failed) {
      summary =
        state.permissionStatus === "denied"
          ? "Approval denied — automation not run."
          : state.lastError || state.summaryText || "Automation did not complete."
      deps.bridge.fail(summary)
    } else {
      summary = state.summaryText || "Automation complete."
      deps.bridge.timeline(summary, "done")
      deps.bridge.complete(summary)
      // Persist the turn + fire compaction, mirroring the legacy success path.
      if (memoryEnabled(state.plan)) {
        await deps.writeTurn({ kind: "agent", input: state.goal, output: summary, summary })
        // Compactor's tail also drives the skill curator on Pro/Max.
        compact({ plan: state.plan }).catch((err) =>
          console.warn("[yomi/graph] compaction error:", err),
        )
      }
    }

    // Learn: record the workflow, and promote a successful recovery to reusable knowledge.
    const durationMs = Math.max(0, Date.now() - new Date(deps.automation.run.startedAt).getTime())
    recordWorkflow({
      agentId: state.agentId,
      goal: state.goal,
      goalKey: goalKeyOf(state.goal),
      tools: state.toolHistory.map((t) => t.tool),
      stepCount: state.stepCount,
      recoveryCount: state.recoveryCount,
      durationMs,
      outcome: failed ? "failure" : "success",
      summary,
    })
    if (!failed && state.recoveryCount > 0 && state.recoveryStrategy) {
      recordRecovery({
        agentId: state.agentId,
        goalKey: goalKeyOf(state.goal),
        error: state.recoveryError,
        strategy: state.recoveryStrategy,
      })
      deps.bridge.timeline("Recorded a learned recovery", "done")
    }

    await deps.hooks.onStop(summary)
    deps.markClosed()
    return { failed, finalSummary: summary, agentStatus: failed ? "failed" : "completed" }
  }
}
