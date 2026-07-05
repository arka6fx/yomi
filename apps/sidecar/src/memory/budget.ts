// Memory budget and context window management.
// Ensures MEMORY.md stays within size limits and critical memories are prioritized.
// Inspired by OpenClaw's memory-budget.ts.

const DEFAULT_BUDGET_CHARS = 10_000
const SECTION_HEADER_OVERHEAD = 100

export type BudgetConfig = {
  maxChars: number
  summaryChars: number
  profileChars: number
  perMemoryAvgChars: number
}

export const DEFAULT_BUDGET: BudgetConfig = {
  maxChars: DEFAULT_BUDGET_CHARS,
  summaryChars: 2000,
  profileChars: 2500,
  perMemoryAvgChars: 300,
}

export type MemoryBlock = {
  id: string
  kind: string
  topic: string
  content: string
  confidence: number
  isStatic: boolean
  updatedAt: string
  score: number
  matchedBy?: string[]
}

// Rank memories by a composite score that balances static priority, recency, confidence,
// and relevance. Returns a prioritized, budget-limited list.
export function rankMemoriesForContext(
  memories: MemoryBlock[],
  budget: BudgetConfig = DEFAULT_BUDGET,
): MemoryBlock[] {
  const now = Date.now()
  const scored = memories.map((m) => {
    const ageDays = (now - new Date(m.updatedAt).getTime()) / 86400000
    const recencyBoost = Math.exp(-(Math.LN2 / 30) * Math.max(0, ageDays))
    const staticBoost = m.isStatic ? 0.3 : 0
    const confidenceNorm = m.confidence / 100
    const relevanceNorm = m.score

    return {
      memory: m,
      score: staticBoost + 0.35 * relevanceNorm + 0.25 * confidenceNorm + 0.15 * recencyBoost,
    }
  })

  scored.sort((a, b) => b.score - a.score)

  const result: MemoryBlock[] = []
  let used = 0
  for (const { memory } of scored) {
    const serialized = `${memory.kind}: ${memory.topic} — ${memory.content}`
    const cost = serialized.length + SECTION_HEADER_OVERHEAD
    if (used + cost > budget.maxChars) break
    result.push(memory)
    used += serialized.length
  }

  return result
}

// Truncate oldest auto-promoted sections from MEMORY.md content to fit within budget.
// Preserves user-authored content and only drops auto-promoted sections (oldest first).
export function compactMemoryForBudget(
  content: string,
  newSection: string,
  budget: BudgetConfig = DEFAULT_BUDGET,
): { compacted: string; droppedDates: string[] } {
  const promotionRegex = /## Promoted From Short-Term Memory \([^)]+\)[\s\S]*?(?=\n## |$)/g
  const existingPromotions: { match: string; date: string }[] = []
  let match
  while ((match = promotionRegex.exec(content)) !== null) {
    const dateMatch = match[0].match(/\(([^)]+)\)/)
    existingPromotions.push({ match: match[0], date: dateMatch?.[1] ?? "" })
  }

  // Calculate size without promotions
  let baseContent = content.replace(promotionRegex, "").trim()
  let currentSize = baseContent.length

  // Sort promotions by date (oldest first for removal priority)
  existingPromotions.sort((a, b) => a.date.localeCompare(b.date))

  const droppedDates: string[] = []
  const remainingPromotions = [...existingPromotions]

  for (const promo of existingPromotions) {
    const projectedSize = currentSize + newSection.length
    if (projectedSize <= budget.maxChars) break

    remainingPromotions.shift()
    currentSize -= promo.match.length
    droppedDates.push(promo.date)
  }

  const compacted = [baseContent, ...remainingPromotions.map((p) => p.match), newSection]
    .filter(Boolean)
    .join("\n\n")

  return { compacted, droppedDates }
}

// Estimate token count from character count (rough: ~4 chars per token)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Summarize memories into a condensed index for system prompt injection.
export function buildMemoryIndex(memories: MemoryBlock[], maxChars: number): string {
  const lines: string[] = []
  let used = 0
  for (const m of memories) {
    const line = `- [${m.kind}] ${m.topic} (confidence: ${m.confidence})`
    if (used + line.length > maxChars) break
    lines.push(line)
    used += line.length
  }
  return lines.join("\n")
}

// Build a narrative summary from memories for higher-level context.
export function buildMemorySummary(memories: MemoryBlock[], maxChars: number): string {
  if (!memories.length) return ""
  const staticFacts = memories.filter((m) => m.isStatic)
  const recentDynamics = memories
    .filter((m) => !m.isStatic)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5)

  const parts: string[] = []
  if (staticFacts.length) {
    parts.push("Stable preferences and facts: " + staticFacts.map((f) => f.topic).join(", "))
  }
  if (recentDynamics.length) {
    parts.push("Recent context: " + recentDynamics.map((d) => d.topic).join(", "))
  }

  const summary = parts.join(". ")
  return summary.length <= maxChars ? summary : summary.slice(0, maxChars) + "..."
}
