import type { Provider } from "./types.js"
import { countWorkflowReplays, listWorkflowReplays } from "../runs.js"

// WorkflowProvider: recorded automation replay catalog. Execution still flows through
// /automation/replay; this provider tells Mission Control whether reusable workflows exist.
export function createWorkflowProvider(
  port = { countWorkflowReplays, listWorkflowReplays },
): Provider {
  return {
    id: "workflow",
    label: "Workflow Provider",
    async healthCheck() {
      const count = port.countWorkflowReplays()
      return {
        ok: true,
        detail: count === 1 ? "1 replayable workflow" : `${count} replayable workflows`,
      }
    },
    async diagnostics() {
      const workflows = port.listWorkflowReplays(5)
      return {
        workflows: workflows.length,
        total: port.countWorkflowReplays(),
        recent: workflows.map((w) => ({
          replayId: w.replayId,
          task: w.task,
          owner: w.ownerLabel,
          endedAt: w.endedAt,
          summary: w.summary,
        })),
      }
    },
    async repair() {
      const count = port.countWorkflowReplays()
      return { ok: true, detail: `workflow catalog reachable (${count} replayable)` }
    },
  }
}

export const workflowProvider = createWorkflowProvider()
