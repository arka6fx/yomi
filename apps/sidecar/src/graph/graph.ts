import { createInitialState, mergeGraphState, type GraphInput, type GraphState } from "./state.js"
import { MAX_RECOVERIES, type GraphDeps } from "./deps.js"
import { makeOrchestratorNode } from "./nodes/orchestrator.js"
import { makePlanningNode } from "./nodes/planning.js"
import { makeMemoryNode } from "./nodes/memory.js"
import { makeExecutionNode } from "./nodes/execution.js"
import { makeValidationNode } from "./nodes/validation.js"
import { makeRecoveryNode } from "./nodes/recovery.js"
import { makeHumanApprovalNode } from "./nodes/human-approval.js"
import { makeCompletionNode } from "./nodes/completion.js"

interface InvokeOptions {
  recursionLimit?: number
}

// Fixed agent graph runner. Per-request deps are baked into node factories, so each request gets an
// isolated graph (concurrency-safe) without bundling LangChain's provider translators into desktop.
export function buildGraph(deps: GraphDeps) {
  const orchestrator = makeOrchestratorNode(deps)
  const planning = makePlanningNode(deps)
  const memory = makeMemoryNode(deps)
  const humanApproval = makeHumanApprovalNode(deps)
  const execution = makeExecutionNode(deps)
  const validation = makeValidationNode(deps)
  const recovery = makeRecoveryNode(deps)
  const completion = makeCompletionNode(deps)

  async function runExecutionWithRetry(state: GraphState): Promise<Partial<GraphState>> {
    let attempt = 0
    for (;;) {
      try {
        return await execution(state)
      } catch (err) {
        attempt++
        if (attempt >= 3) throw err
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)))
      }
    }
  }

  return {
    async invoke(input: GraphInput, options?: InvokeOptions): Promise<GraphState> {
      let state = createInitialState(input)
      const recursionLimit = options?.recursionLimit ?? 50
      let iterations = 0

      const step = async (patch: Promise<Partial<GraphState>>) => {
        iterations++
        if (iterations > recursionLimit) throw new Error("Graph recursion limit exceeded")
        state = mergeGraphState(state, await patch)
      }

      await step(orchestrator(state))
      const [planningPatch, memoryPatch] = await Promise.all([planning(state), memory(state)])
      state = mergeGraphState(mergeGraphState(state, planningPatch), memoryPatch)

      if (state.executionMode === "approval") {
        await step(humanApproval(state))
        if (state.permissionStatus === "denied") {
          await step(completion(state))
          return state
        }
      }

      for (;;) {
        await step(runExecutionWithRetry(state))
        await step(validation(state))
        if (state.validationStatus === "passed" || state.recoveryCount >= MAX_RECOVERIES) {
          await step(completion(state))
          return state
        }
        await step(recovery(state))
      }
    },
  }
}
