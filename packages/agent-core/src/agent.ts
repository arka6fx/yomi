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
  // Model id; defaults to OPENAI_AGENT_MODEL.
  model?: string
  // Max ReAct steps. Defaults to AGENT_MAX_STEPS or 25.
  maxSteps?: number
  // Cumulative output-token budget for the run. Defaults to
  // AGENT_MAX_OUTPUT_TOKENS or 16384. Distinct from maxTokens (per-call cap).
  maxOutputTokens?: number
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
  return override || process.env["OPENAI_AGENT_MODEL"] || "gpt-5.5"
}

// Backend and sidecar read the same env contract so both surfaces can be tuned
// together; defaults match the sidecar's IterationBudget.
function maxSteps(override?: number): number {
  if (typeof override === "number") return override
  return parseInt(process.env["AGENT_MAX_STEPS"] || "25", 10)
}

function maxOutputTokens(override?: number): number {
  if (typeof override === "number") return override
  return parseInt(process.env["AGENT_MAX_OUTPUT_TOKENS"] || "16384", 10)
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

type ResponseMessages = Awaited<ReturnType<typeof generateText>>["response"]["messages"]

// Lean, text-only tool-calling loop over the OpenAI model provider and
// connector tools. Runs in both the sidecar and backend; returns final text.
// Driven as an explicit single-step sequence (not one multi-step generateText)
// so a cost-aware budget can halt mid-run yet keep the transcript for the grace
// call — v4's onStepFinish can observe a step but can't stop the loop.
export async function runAgentLoop(opts: RunAgentLoopOptions): Promise<string> {
  const tools: ToolSet = {
    ...createConnectorTools(opts.registry),
    ...(opts.extraTools ?? {}),
  }

  const model = agentModel(opts.model)
  const llm = createModel(model)
  const system = opts.system ?? defaultSystem()
  const stepBudget = maxSteps(opts.maxSteps)
  const tokenBudget = maxOutputTokens(opts.maxOutputTokens)

  const messages: AgentMessage[] = [...(opts.history ?? []), { role: "user", content: opts.text }]
  const transcript: ResponseMessages = []

  let usedSteps = 0
  let inputTokens = 0
  let outputTokens = 0
  let toolCallCount = 0
  let budgetReason: "steps" | "tokens" | null = null
  let lastToolResults: readonly unknown[] = []

  // Emit run-cumulative usage once, at the terminal exit. The backend persists
  // onUsage into a single usage_events row (last write wins), so per-step
  // emission would clobber the row down to just the final call's tiny totals.
  const finish = (text: string, finishReason: string): string => {
    opts.onUsage?.({ model, inputTokens, outputTokens, toolCallCount, finishReason })
    return text
  }

  while (true) {
    if (usedSteps >= stepBudget) {
      budgetReason = "steps"
      break
    }
    if (outputTokens >= tokenBudget) {
      budgetReason = "tokens"
      break
    }

    const result = await generateText({
      model: llm,
      system,
      messages: [...messages, ...transcript] as typeof messages,
      tools,
      maxSteps: 1,
      maxTokens: opts.maxTokens,
      abortSignal: opts.signal,
    })

    usedSteps++
    inputTokens += result.usage.promptTokens
    outputTokens += result.usage.completionTokens
    toolCallCount += result.toolCalls.length
    transcript.push(...result.response.messages)
    lastToolResults = result.toolResults

    // The model produced a final turn (no further tool calls requested).
    if (result.toolCalls.length === 0) {
      if (result.text.trim()) return finish(result.text, result.finishReason)
      break // stopped with empty text → grace call below
    }
    // Otherwise tools ran this step; loop so the model can react to their results.
  }

  // Grace call (hermes pattern): either a budget was exhausted mid-work or the
  // loop ended with empty text after tool work. Re-run once over the accumulated
  // transcript with toolChoice:"none" so the model must summarise what the tools
  // returned instead of us dumping raw tool JSON. Tools stay declared so the
  // transcript's tool calls still validate.
  if (transcript.length > 0) {
    try {
      const grace = await generateText({
        model: llm,
        system,
        messages: [...messages, ...transcript] as typeof messages,
        tools,
        toolChoice: "none",
        maxTokens: opts.maxTokens,
        abortSignal: opts.signal,
      })
      inputTokens += grace.usage.promptTokens
      outputTokens += grace.usage.completionTokens
      if (grace.text.trim()) {
        return finish(grace.text, budgetReason ? `budget:${budgetReason}` : `grace:${grace.finishReason}`)
      }
    } catch (err) {
      console.warn(`[agent] grace call failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const fallback = fallbackFromToolResults(lastToolResults)
  if (fallback) return finish(fallback, budgetReason ? `budget:${budgetReason}` : "fallback")

  console.warn(
    `[agent] empty final text reason=${budgetReason ?? "empty"} steps=${usedSteps} outputTokens=${outputTokens}`,
  )
  return finish("", budgetReason ? `budget:${budgetReason}` : "empty")
}
