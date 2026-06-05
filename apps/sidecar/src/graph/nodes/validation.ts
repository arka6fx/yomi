import type { GraphDeps } from "../deps.js"
import type { GraphState } from "../state.js"
import { resolveAgent } from "../../automation/agents/registry.js"

// Validation: confirm the outcome. No task completes until validated. The active sub-agent runs a
// provider-specific check first (e.g. Spotify "is a track playing?"); it is tri-state so it only
// overrides on POSITIVE evidence. On "inconclusive" we fall back to the phase-1 rubric: the burst
// recorded no error and no tool reported failure (lastError unset).
export function makeValidationNode(deps: GraphDeps) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    deps.bridge.step("Validating outcome", { state: "executing" })
    const agent = resolveAgent(state.goal)
    const verdict = await agent
      .validate({ goal: state.goal, lastError: state.lastError, uia: deps.uia })
      .catch(() => "inconclusive" as const)

    const passed = verdict === "pass" ? true : verdict === "fail" ? false : !state.lastError
    const how = verdict === "inconclusive" ? "rubric" : `${agent.label} check`
    deps.bridge.timeline(
      passed
        ? `Validation passed (${how})`
        : `Validation failed (${how}): ${state.lastError ?? verdict}`,
      passed ? "done" : "failed",
    )
    return { validationStatus: passed ? "passed" : "failed", currentStep: "Validating" }
  }
}
