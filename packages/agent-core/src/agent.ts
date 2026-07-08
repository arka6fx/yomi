import { generateText, type ToolSet } from "ai"
import { createModel } from "./model.js"
import { createConnectorTools } from "./tools.js"
import type { ConnectorRegistry } from "./connectors/registry.js"

export interface AgentMessage {
  role: "user" | "assistant" | "system"
  content: string
}

export interface UsageInfo {
  model: string
  inputTokens: number
  outputTokens: number
  toolCallCount: number
  finishReason: string
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
  // Hard cap response verbosity for chat surfaces.
  maxTokens?: number
  // Extra tools to merge in (beyond the connector tools).
  extraTools?: ToolSet
  signal?: AbortSignal
  // Called after each generateText with usage telemetry.
  onUsage?: (usage: UsageInfo) => void
}

function defaultSystem(): string {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const appUrl = process.env["YOMI_APP_URL"] ?? "https://getyomi.in"
  return (
    `You are Yomi, a helpful AI assistant. Today is ${today}. Answer the user concisely. ` +
    "When the user asks about their email or connected apps, use the available " +
    "tools to fetch real data before answering. " +
    "If a tool reports a service is not connected, tell the user it isn't connected yet " +
    `and suggest they connect it at ${appUrl}/dashboard. ` +
    "If a tool returns an authorization or token error, tell the user their integration " +
    `may have expired and suggest they reconnect at ${appUrl}/dashboard.`
  )
}

function agentModel(override?: string): string {
  return override || process.env["AI_CREDITS_AGENT_MODEL"] || "gpt-5.5"
}

function maxSteps(override?: number): number {
  if (typeof override === "number") return override
  return parseInt(process.env["AGENT_MAX_STEPS"] || "12", 10)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function formatToolItem(item: unknown): string | null {
  if (!isRecord(item)) return null
  const name =
    typeof item["name"] === "string"
      ? item["name"]
      : typeof item["title"] === "string"
        ? item["title"]
        : null
  if (!name) return null
  const type = typeof item["type"] === "string" ? ` (${item["type"]})` : ""
  const link = typeof item["link"] === "string" ? `, ${item["link"]}` : ""
  return `- ${name}${type}${link}`
}

function formatToolResultValue(value: unknown): string | null {
  if (!isRecord(value)) return null
  if (typeof value["message"] === "string" && value["message"]) return value["message"]

  for (const key of [
    "files",
    "emails",
    "events",
    "courses",
    "assignments",
    "announcements",
  ] as const) {
    const items = value[key]
    if (!Array.isArray(items)) continue
    if (items.length === 0) return `No ${key} found.`
    const lines = items
      .map(formatToolItem)
      .filter((line): line is string => Boolean(line))
      .slice(0, 10)
    if (lines.length > 0) return lines.join("\n")
  }

  if (value["ok"] === true) {
    const parts: string[] = []
    for (const k of ["fullName", "name", "title", "url", "path", "id"] as const) {
      const v = value[k]
      if (typeof v === "string" && v) parts.push(v)
    }
    if (parts.length > 0) return `Completed: ${parts.join(" · ")}`
  }

  const preview = JSON.stringify(value, null, 2)
  return preview.length > 1400 ? `${preview.slice(0, 1400)}...` : preview
}

function fallbackFromToolResults(toolResults: readonly unknown[]): string {
  const blocks: string[] = []
  for (const toolResult of toolResults) {
    const value = isRecord(toolResult) && "result" in toolResult ? toolResult["result"] : toolResult
    const formatted = formatToolResultValue(value)
    if (formatted) blocks.push(formatted)
  }
  if (blocks.length === 0) return ""
  return blocks.join("\n\n")
}

// Lean, text-only tool-calling loop over the AI Credits model provider and
// connector tools. Runs in both the sidecar and backend; returns final text.
export async function runAgentLoop(opts: RunAgentLoopOptions): Promise<string> {
  const tools: ToolSet = {
    ...createConnectorTools(opts.registry),
    ...(opts.extraTools ?? {}),
  }

  const messages: AgentMessage[] = [...(opts.history ?? []), { role: "user", content: opts.text }]

  const result = await generateText({
    model: createModel(agentModel(opts.model)),
    system: opts.system ?? defaultSystem(),
    messages,
    tools,
    maxSteps: maxSteps(opts.maxSteps),
    maxTokens: opts.maxTokens,
    abortSignal: opts.signal,
  })

  opts.onUsage?.({
    model: agentModel(opts.model),
    inputTokens: result.usage.promptTokens,
    outputTokens: result.usage.completionTokens,
    toolCallCount: result.toolCalls.length,
    finishReason: result.finishReason,
  })

  if (result.text.trim()) return result.text

  const fallback = fallbackFromToolResults(result.toolResults)
  if (fallback) return fallback

  console.warn(
    `[agent] empty final text finishReason=${result.finishReason} toolCalls=${result.toolCalls.length} toolResults=${result.toolResults.length}`,
  )
  return result.text
}
