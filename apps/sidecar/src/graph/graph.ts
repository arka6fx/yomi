import { StateGraph, START, END } from "@langchain/langgraph"
import { GraphAnnotation, type GraphState } from "./state.js"
import { MAX_RECOVERIES, type GraphDeps } from "./deps.js"
import { makeOrchestratorNode } from "./nodes/orchestrator.js"
import { makePlanningNode } from "./nodes/planning.js"
import { makeMemoryNode } from "./nodes/memory.js"
import { makeExecutionNode } from "./nodes/execution.js"
import { makeValidationNode } from "./nodes/validation.js"
import { makeRecoveryNode } from "./nodes/recovery.js"
import { makeHumanApprovalNode } from "./nodes/human-approval.js"
import { makeCompletionNode } from "./nodes/completion.js"

// Build the agent-path StateGraph. Structure is static; per-request deps (emit/signal/tools) are
// baked into node factories, so each request gets an isolated compiled graph (concurrency-safe).
//
// planning and memory run in parallel from orchestrator — neither depends on the other's output
// (memory reads state.goal + state.plan[subscription tier], both set before orchestrator fires).
// A barrier join ["planning","memory"] → "route" ensures both complete before execution routing.
export function buildGraph(deps: GraphDeps) {
  const route = (s: GraphState) =>
    s.executionMode === "approval" ? "humanApproval" : "execution"
  const afterApproval = (s: GraphState) =>
    s.permissionStatus === "denied" ? "completion" : "execution"
  const afterValidation = (s: GraphState) => {
    if (s.validationStatus === "passed") return "completion"
    return s.recoveryCount < MAX_RECOVERIES ? "recovery" : "completion"
  }

  return new StateGraph(GraphAnnotation)
    .addNode("orchestrator", makeOrchestratorNode(deps))
    .addNode("planning", makePlanningNode(deps))
    .addNode("memory", makeMemoryNode(deps))
    .addNode("route", async (_: GraphState): Promise<Partial<GraphState>> => ({}))
    .addNode("humanApproval", makeHumanApprovalNode(deps))
    .addNode("execution", makeExecutionNode(deps), {
      // Retry transient connector/LLM errors (429s, timeouts) before escalating to Recovery.
      retryPolicy: { maxAttempts: 3, initialInterval: 500, backoffFactor: 2 },
    })
    .addNode("validation", makeValidationNode(deps))
    .addNode("recovery", makeRecoveryNode(deps))
    .addNode("completion", makeCompletionNode(deps))
    .addEdge(START, "orchestrator")
    .addEdge("orchestrator", "planning")
    .addEdge("orchestrator", "memory")
    .addEdge(["planning", "memory"], "route")
    .addConditionalEdges("route", route, {
      humanApproval: "humanApproval",
      execution: "execution",
    })
    .addConditionalEdges("humanApproval", afterApproval, {
      execution: "execution",
      completion: "completion",
    })
    .addEdge("execution", "validation")
    .addConditionalEdges("validation", afterValidation, {
      recovery: "recovery",
      completion: "completion",
    })
    .addEdge("recovery", "execution")
    .addEdge("completion", END)
    .compile()
}
