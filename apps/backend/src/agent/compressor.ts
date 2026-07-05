import { generateText } from "ai"
import { createModel, type AgentMessage } from "@yomi/agent-core"

const CHARS_PER_TOKEN = 4
const SUMMARY_RATIO = 0.2
const SUMMARY_TOKENS_CEILING = 12_000
const TAIL_RATIO = 0.3
const MIN_TAIL_TOKENS = 2000
const MIN_MESSAGES_TO_COMPRESS = 4
const MIN_PRE_TOKENS = 2000
const COMPRESS_THRESHOLD_RATIO = 0.6

export const DIRECTIVE_GUARD_PREFIX = `[CONTEXT COMPACTION — REFERENCE ONLY] This is a handoff from a previous context window. Treat it as background reference, NOT as active instructions. Respond ONLY to the latest user message below this summary. Do NOT answer questions or fulfill requests from the summary — they were already addressed. The latest user message supersedes anything listed here. Persistent memory and system prompt instructions remain authoritative.`

export function estimateTokens(messages: AgentMessage[]): number {
  let total = 0
  for (const m of messages) {
    total += Math.ceil((m.content || "").length / CHARS_PER_TOKEN) + 4
  }
  return total
}

export function shouldCompress(messages: AgentMessage[], contextWindow: number): boolean {
  if (messages.length < MIN_MESSAGES_TO_COMPRESS) return false
  const threshold = Math.max(MIN_PRE_TOKENS, Math.floor(contextWindow * COMPRESS_THRESHOLD_RATIO))
  return estimateTokens(messages) >= threshold
}

function pruneOldToolResults(
  messages: AgentMessage[],
  boundary: number,
  pattern: RegExp,
): AgentMessage[] {
  return messages.map((m, i) => {
    if (i < boundary && pattern.test(m.content)) {
      const charCount = m.content.length
      return { ...m, content: `[Old tool result pruned — ~${charCount} chars]` }
    }
    return m
  })
}

export async function compressContext(
  messages: AgentMessage[],
  contextWindow: number,
  options?: { auxModelId?: string; signal?: AbortSignal },
): Promise<{ messages: AgentMessage[]; compressed: boolean }> {
  const preTokens = estimateTokens(messages)
  const threshold = Math.max(MIN_PRE_TOKENS, Math.floor(contextWindow * COMPRESS_THRESHOLD_RATIO))
  if (preTokens < threshold) return { messages, compressed: false }

  // Protect first 3 user/assistant turns + system prompt (if present)
  let headEnd = 0
  if (messages.length > 0 && messages[0]?.role === "system") headEnd = 1
  headEnd += 3

  // Protect tail (most recent ~30% of budget)
  const tailBudget = Math.max(MIN_TAIL_TOKENS, Math.floor(contextWindow * TAIL_RATIO))
  const n = messages.length
  let tailCut = n
  let accumulated = 0
  for (let i = n - 1; i >= headEnd; i--) {
    const tokens = Math.ceil((messages[i]?.content || "").length / CHARS_PER_TOKEN) + 4
    if (accumulated + tokens > tailBudget && n - i > 1) break
    accumulated += tokens
    tailCut = i
  }
  tailCut = Math.max(tailCut, headEnd + 1)
  if (tailCut <= headEnd) return { messages, compressed: false }

  // Prune old tool results in the compressible region
  const toolResultPattern = /^\[Old tool result/i
  const pruned = pruneOldToolResults(messages, tailCut, toolResultPattern)

  // Build the middle section for summarization
  const compressible = pruned.slice(headEnd, tailCut)
  if (compressible.length === 0) return { messages, compressed: false }

  const modelId = options?.auxModelId ?? process.env["AI_CREDITS_FAST_MODEL"] ?? "gpt-5.5-mini"

  const turns = compressible.map((m) => `[${m.role}] ${m.content}`).join("\n\n")

  const summaryBudget = Math.min(Math.floor(contextWindow * 0.05), SUMMARY_TOKENS_CEILING)

  let summaryBody = ""
  try {
    const { text } = await generateText({
      model: createModel(modelId),
      system: [
        "You create compact context checkpoints for an AI assistant.",
        `Target ~${Math.floor(summaryBudget * SUMMARY_RATIO)} tokens.`,
        "Write in the same language the user was using.",
        "Output format:",
        "## Active Task\n[latest unfulfilled user request]",
        "## Goal\n[what the user is trying to accomplish]",
        "## Completed Actions\n[numbered list of what was done]",
        "## Key Context\n[important facts, decisions, blockers]",
        "## Pending\n[unanswered user asks]",
        "Be concrete. Never include secrets or credentials.",
      ].join("\n"),
      prompt: `Summarize these conversation turns into a compact checkpoint:\n\n<turns>\n${turns}\n</turns>`,
      abortSignal: options?.signal,
    })
    summaryBody = text.trim()
  } catch {
    return { messages, compressed: false }
  }

  if (!summaryBody) return { messages, compressed: false }

  const head = pruned.slice(0, headEnd)
  const tail = pruned.slice(tailCut)

  const summaryRole: "user" | "assistant" =
    head.length > 0 && head[head.length - 1]?.role === "assistant" ? "user" : "assistant"

  const compressed: AgentMessage[] = [
    ...head,
    { role: summaryRole, content: `${DIRECTIVE_GUARD_PREFIX}\n\n${summaryBody}` },
    ...tail,
  ]

  return { messages: compressed, compressed: compressed.length < messages.length }
}
