import { streamText } from "ai"
import type { CoreMessage } from "ai"
import { redactAutomationPayload } from "../../automation/runs.js"
import { resolveAgent, scopeTools } from "../../automation/agents/registry.js"
import { AGENT_PATH_MODEL, BURST_STEPS, type GraphDeps } from "../deps.js"
import type { GraphState, ToolHistoryItem } from "../state.js"

// Same stream-event shape the legacy agent consumed from the AI SDK fullStream.
type AgentStreamEvent =
  | { type: "text-delta"; textDelta: string }
  | { type: "tool-call"; toolName: string; args: unknown }
  | { type: "tool-result"; toolName: string; result: unknown }
  | { type: "step-finish" }
  | { type: "error"; error: unknown }
  | { type: string }

function toolFailed(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    ("error" in result || ("ok" in result && (result as { ok?: unknown }).ok === false))
  )
}

// ExecutionNode: run a bounded model-bound tool loop (the "ReAct loop", now owned by the graph)
// reusing the existing merged tool set, hooks, and LoopGuards. Emits the same agent_* / automation_*
// events as the legacy pipeline so chat rendering and the Island are unaffected. Failures surface
// via lastError, which Validation/Recovery act on.
export function makeExecutionNode(deps: GraphDeps) {
  return async (state: GraphState): Promise<Partial<GraphState>> => {
    if (deps.signal?.aborted) {
      return { lastError: "cancelled", failed: true, validationStatus: "failed" }
    }
    // Route to the planned sub-agent: scope the merged tool set to its allowance and focus the prompt.
    // Agents that declare no scope inherit the full set unchanged (no regression to existing flows).
    const agent = resolveAgent(state.goal)
    const tools = scopeTools(await deps.toolsPromise, agent)
    const system = agent.systemHint
      ? `${state.systemPrompt}\n\n${agent.systemHint}`
      : state.systemPrompt
    deps.bridge.step(`Executing plan (${agent.label})`, { state: "executing" })
    const result = streamText({
      model: deps.modelFactory(AGENT_PATH_MODEL),
      system,
      messages: state.messages,
      tools,
      maxSteps: BURST_STEPS,
      abortSignal: deps.signal,
    })

    let stepCount = state.stepCount
    let assistantText = ""
    let lastError: string | null = null
    let broke = false
    const newTools: ToolHistoryItem[] = []

    for await (const event of result.fullStream as AsyncIterable<AgentStreamEvent>) {
      switch (event.type) {
        case "text-delta": {
          const delta = (event as { textDelta: string }).textDelta
          assistantText += delta
          deps.bridge.raw({ type: "agent_text", text: delta })
          break
        }
        case "tool-call": {
          const e = event as { toolName: string; args: Record<string, unknown> }
          const guard = deps.guards.onToolCall(e.toolName, e.args)
          deps.bridge.step(`Using ${e.toolName}`, {
            state: "executing",
            nextStep: "Review tool result",
          })
          deps.bridge.timeline(
            `Started ${e.toolName}`,
            "running",
            JSON.stringify(redactAutomationPayload(e.args)),
          )
          deps.bridge.raw({ type: "agent_tool_call", tool: e.toolName, args: e.args })
          if (guard.break) {
            lastError = guard.reason
            deps.bridge.timeline(guard.reason, "failed")
            broke = true
          }
          break
        }
        case "tool-result": {
          const e = event as { toolName: string; result: unknown }
          const failed = toolFailed(e.result)
          newTools.push({ tool: e.toolName, failed })
          if (failed) lastError = `tool ${e.toolName} failed`
          deps.bridge.timeline(
            `Finished ${e.toolName}`,
            failed ? "failed" : "done",
            JSON.stringify(redactAutomationPayload(e.result)),
          )
          deps.bridge.raw({ type: "agent_tool_result", tool: e.toolName, result: e.result })
          break
        }
        case "step-finish": {
          stepCount++
          deps.bridge.step(`Agent step ${stepCount}`, {
            state: "executing",
            step: stepCount,
            maxSteps: BURST_STEPS,
          })
          deps.bridge.raw({ type: "agent_step", iteration: stepCount, max: BURST_STEPS })
          const guard = deps.guards.onStep()
          if (guard.break) {
            lastError = guard.reason
            deps.bridge.timeline(guard.reason, "failed")
            broke = true
          }
          break
        }
        case "error": {
          const err = (event as { error: unknown }).error
          lastError = err instanceof Error ? err.message : String(err)
          broke = true
          break
        }
      }
      if (broke) break
    }

    // Carry the model + tool messages forward so a Recovery re-entry has full context. When the
    // burst was cut short by a guard/error, fall back to the partial assistant text.
    let newMessages: CoreMessage[] = []
    if (!broke) {
      try {
        newMessages = (await result.response).messages as CoreMessage[]
      } catch {
        if (assistantText) newMessages = [{ role: "assistant", content: assistantText }]
      }
    } else if (assistantText) {
      newMessages = [{ role: "assistant", content: assistantText }]
    }

    const summaryText = assistantText.replace(/\n/g, " ").trim()
    return {
      messages: newMessages,
      toolHistory: newTools,
      stepCount,
      lastError,
      summaryText,
      validationStatus: "pending",
      agentStatus: "executing",
    }
  }
}
