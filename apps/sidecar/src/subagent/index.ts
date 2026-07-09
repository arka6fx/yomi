import { streamText } from "ai"
import { createModel } from "../pipeline/model.js"
import { createMemoryTools } from "../tools/memory.js"
import { createWebTools } from "../tools/web.js"
import { createSystemTools } from "../tools/system.js"
import type { CoreMessage, ToolSet } from "ai"
import type { Plan } from "@yomi/shared"

const AGENT_MODEL = process.env["OPENAI_AGENT_MODEL"] || "gpt-4.1"

export type SubagentRole = "leaf" | "orchestrator"

export interface SubagentRunOptions {
  role: SubagentRole
  goal: string
  context?: string[]
  toolsets?: string[]
  signal?: AbortSignal
  plan?: Plan
  maxSteps?: number
  model?: string
}

export interface SubagentResult {
  summary: string
  messages: CoreMessage[]
  toolCalls: number
  ok: boolean
  error?: string
}

const LEAF_TOOLS = new Set([
  "add_memory",
  "retrieve_memory",
  "list_memories",
  "delete_memory",
  "web_search",
  "fetch_url",
])

const ORCHESTRATOR_TOOLS = new Set([
  "add_memory",
  "retrieve_memory",
  "list_memories",
  "delete_memory",
  "web_search",
  "fetch_url",
  "bash",
  "look_at_screen",
])

function checkPlanAccess(plan: Plan | undefined, role: SubagentRole): string | null {
  if (role === "orchestrator" && plan !== "max") {
    return "orchestrator role requires a Max plan"
  }
  return null
}

function buildRoleTools(role: SubagentRole, plan: Plan | undefined): ToolSet {
  if (role === "leaf") {
    const all = {
      ...createMemoryTools(),
      ...createWebTools(),
    }
    return Object.fromEntries(Object.entries(all).filter(([k]) => LEAF_TOOLS.has(k)))
  }

  const all = {
    ...createMemoryTools(),
    ...createWebTools(),
    ...createSystemTools({}),
  }
  return Object.fromEntries(Object.entries(all).filter(([k]) => ORCHESTRATOR_TOOLS.has(k)))
}

async function loadContext(context?: string[]): Promise<string> {
  if (!context?.length) return ""
  const text = context.join("\n\n---\n\n")
  return text ? `<context>\n${text}\n</context>` : ""
}

export async function runSubagent(opts: SubagentRunOptions): Promise<SubagentResult> {
  if (opts.signal?.aborted) {
    return { ok: false, error: "superseded", summary: "", messages: [], toolCalls: 0 }
  }

  const planError = checkPlanAccess(opts.plan, opts.role)
  if (planError) {
    return { ok: false, error: planError, summary: "", messages: [], toolCalls: 0 }
  }

  const tools = buildRoleTools(opts.role, opts.plan)
  const contextText = await loadContext(opts.context)
  const system = [
    `You are a ${opts.role} subagent. Complete the assigned task and return a concise summary of what you did and found.`,
    contextText || null,
  ]
    .filter(Boolean)
    .join("\n\n")

  const maxSteps = opts.maxSteps ?? 10
  const modelId = opts.model ?? AGENT_MODEL

  try {
    const result = streamText({
      model: createModel(modelId),
      system,
      prompt: opts.goal,
      tools,
      maxSteps,
      abortSignal: opts.signal,
    })

    let summary = ""
    for await (const chunk of result.textStream) {
      summary += chunk
    }

    const response = await result.response
    const finalMessages = response.messages
    const toolCalls = finalMessages.reduce((count: number, m: CoreMessage) => {
      if (m.role === "assistant" && Array.isArray(m.content)) {
        return (
          count +
          (m.content as Array<{ type: string }>).filter(
            (c: { type: string }) => c.type === "tool-call",
          ).length
        )
      }
      return count
    }, 0)

    return { summary, messages: finalMessages, toolCalls, ok: true }
  } catch (err) {
    if (opts.signal?.aborted) {
      return { ok: false, error: "superseded", summary: "", messages: [], toolCalls: 0 }
    }
    const error = err instanceof Error ? err.message : String(err)
    return { ok: false, error, summary: "", messages: [], toolCalls: 0 }
  }
}

export async function runSubagentBatch(opts: {
  tasks: SubagentRunOptions[]
  concurrency?: number
}): Promise<SubagentResult[]> {
  const cap = Math.min(opts.concurrency ?? 3, 5)
  const results: SubagentResult[] = []

  for (let i = 0; i < opts.tasks.length; i += cap) {
    const chunk = opts.tasks.slice(i, i + cap)
    const settled = await Promise.allSettled(chunk.map((t) => runSubagent(t)))

    for (const r of settled) {
      if (r.status === "fulfilled") {
        results.push(r.value)
      } else {
        results.push({
          ok: false,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          summary: "",
          messages: [],
          toolCalls: 0,
        })
      }
    }
  }

  return results
}
