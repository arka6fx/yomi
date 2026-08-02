// Injected memories carry their age so the model can tell a correction from the
// thing it corrected. Without it two contradictory memories look equally current
// and the model picks arbitrarily — see ADR 0006.

export type MemoryAgeInput = string | Date | null | undefined

const DAY = 24 * 60 * 60 * 1000

// The pg driver hands back Date for timestamp columns, but the raw-SQL row types
// cast them as string — accept either rather than trust the cast.
const startOfUtcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

export function formatMemoryAge(updatedAt: MemoryAgeInput, now: Date = new Date()): string {
  if (!updatedAt) return ""
  const then = updatedAt instanceof Date ? updatedAt : new Date(updatedAt)
  if (!Number.isFinite(then.getTime())) return ""

  // Calendar days, not elapsed hours: a memory saved at 23:00 has to read
  // "yesterday" the next morning, not "today". UTC — the backend runs UTC.
  const days = Math.round((startOfUtcDay(now) - startOfUtcDay(then)) / DAY)
  if (days <= 0) return "today" // <= 0 also absorbs clock skew and future timestamps
  if (days === 1) return "yesterday"
  if (days < 7) return `${days}d ago`
  if (days < 35) return `${Math.round(days / 7)}w ago`
  if (days < 345) return `${Math.round(days / 30)}mo ago`
  return `${Math.round(days / 365)}y ago`
}

export type MemorySnippetRow = {
  kind: string
  topic: string
  content: string
  sourcePath?: string | null
  updatedAt?: MemoryAgeInput
  matchedBy?: string[]
}

// Deliberately omits confidence: it was the only recency-ish signal in the prompt
// and it is not one, so the model preferred stale-but-confident memories.
export function formatMemorySnippet(row: MemorySnippetRow, now: Date = new Date()): string {
  const matched = row.matchedBy?.length ? ` (${row.matchedBy.join("+")})` : ""
  const age = formatMemoryAge(row.updatedAt, now)
  const meta = age ? `${row.kind}${matched}, ${age}` : `${row.kind}${matched}`
  const source = row.sourcePath ? ` (source: ${row.sourcePath})` : ""
  return `- [${meta}] ${row.topic}: ${row.content}${source}`
}

export type ProfileLineRow = {
  summary?: string | null
  content: string
  updatedAt?: MemoryAgeInput
}

export function formatProfileLine(row: ProfileLineRow, now: Date = new Date()): string {
  const age = formatMemoryAge(row.updatedAt, now)
  return `- ${age ? `[${age}] ` : ""}${row.summary || row.content}`
}
