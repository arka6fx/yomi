import { generateText, type ToolSet } from "ai"
import { createModel } from "./model.js"
import { createConnectorTools } from "./tools.js"
import type { ConnectorRegistry } from "./connectors/registry.js"

export interface AgentMessage {
  role: "user" | "assistant" | "system"
  content: string
}

export interface RunAgentLoopOptions {
  // Per-user connector registry (already init()'d with the user's providers).
  registry: ConnectorRegistry
  // The user's new message.
  text: string
  // Prior turns, oldest first.
  history?: AgentMessage[]
  // System prompt. A minimal default is used when omitted.
  system?: string
  // Model id; defaults to AI_CREDITS_AGENT_MODEL.
  model?: string
  // Max ReAct steps. Defaults to AGENT_MAX_STEPS or 12.
  maxSteps?: number
  // Extra tools to merge in (beyond the connector tools).
  extraTools?: ToolSet
  signal?: AbortSignal
}

const DEFAULT_SYSTEM =
  "You are Yomi, a helpful AI assistant. Answer the user concisely. " +
  "When the user asks about their email or connected apps, use the available " +
  "tools to fetch real data before answering. If a tool reports a service is " +
  "not connected, tell the user it isn't connected yet rather than guessing."

function agentModel(override?: string): string {
  return override || process.env["AI_CREDITS_AGENT_MODEL"] || "gpt-4.1"
}

function maxSteps(override?: number): number {
  if (typeof override === "number") return override
  return parseInt(process.env["AGENT_MAX_STEPS"] || "12", 10)
}

// Lean, text-only tool-calling ReAct loop over the AI Credits model provider and
// connector tools. No vision, STT/TTS, or UIA — those stay sidecar-only. Runs in
// both the sidecar and the backend; returns the agent's final text answer.
export async function runAgentLoop(opts: RunAgentLoopOptions): Promise<string> {
  const tools: ToolSet = {
    ...createConnectorTools(opts.registry),
    ...(opts.extraTools ?? {}),
  }

  const messages: AgentMessage[] = [
    ...(opts.history ?? []),
    { role: "user", content: opts.text },
  ]

  const result = await generateText({
    model: createModel(agentModel(opts.model)),
    system: opts.system ?? DEFAULT_SYSTEM,
    messages,
    tools,
    maxSteps: maxSteps(opts.maxSteps),
    abortSignal: opts.signal,
  })

  return result.text
}
