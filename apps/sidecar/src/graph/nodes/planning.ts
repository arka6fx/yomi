import type { GraphDeps } from "../deps.js"
import type { ExecutionMode, GraphState } from "../state.js"
import { buildAutomationPreview, classifyAutomationRisk } from "../../automation/runs.js"
import { resolveAgent } from "../../automation/agents/registry.js"

// Planning: break the request into steps, estimate requirements, decide execution mode, and route to
// the sub-agent that will run it. Dangerous tasks (send/delete/pay/...) require approval; otherwise
// desktop automation is foreground-specific.
export function makePlanningNode(deps: GraphDeps) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    const risk = classifyAutomationRisk(state.goal)
    const preview = buildAutomationPreview(state.goal)
    const mode: ExecutionMode = risk === "dangerous" ? "approval" : "foreground"
    const agent = resolveAgent(state.goal)
    deps.bridge.step("Planning steps", { state: "thinking", maxSteps: preview.steps.length })
    deps.bridge.timeline("Built execution plan", "planned")
    deps.bridge.timeline(`Spawned ${agent.label}`, "planned", `provider: ${agent.provider}`)
    return {
      steps: preview.steps,
      executionMode: mode,
      agentId: agent.id,
      providerId: agent.provider,
      currentStep: "Planning",
      agentStatus: "thinking",
    }
  }
}
