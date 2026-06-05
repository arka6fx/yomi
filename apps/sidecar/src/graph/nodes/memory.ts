import type { GraphDeps } from "../deps.js"
import type { GraphState } from "../state.js"
import { buildGraphSystemPrompt } from "../prompts.js"
import { knowledgeHint, recallKnowledge } from "../../automation/knowledge.js"

// Memory: retrieve relevant context (profiles, summary, local + cloud RAG, recent session) and
// build the system prompt. Injects only the bounded bundle — never the entire memory store. Also
// consults the Knowledge Base so the agent reuses prior successful approaches before executing.
export function makeMemoryNode(deps: GraphDeps) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    const built = await buildGraphSystemPrompt(state.goal, state.plan)
    const memoryRefs = built.memoryRefs
    let systemPrompt = built.systemPrompt
    if (memoryRefs.length) deps.bridge.timeline(`Loaded memory: ${memoryRefs.join(", ")}`, "done")

    const recall = recallKnowledge(state.agentId, state.goal)
    const hint = knowledgeHint(recall)
    if (hint) {
      systemPrompt = `${systemPrompt}\n\n${hint}`
      deps.bridge.timeline(
        `Recalled prior experience (${recall.workflows.length} workflows, ${recall.recoveries.length} fixes)`,
        "done",
      )
    }
    return { systemPrompt, memoryRefs, agentStatus: "thinking" }
  }
}
