// Injected memories carry their age so the model can tell a correction from the
// thing it corrected. Without it two contradictory memories look equally current
// and the model picks arbitrarily — see ADR 0006.

export type MemoryAgeInput = string | Date | null | undefined

const DAY = 24 * 60 * 60 * 1000

export function formatMemoryAge(updatedAt: MemoryAgeInput, now: Date = new Date()): string {
  if (!updatedAt) return ""
  const then = updatedAt instanceof Date ? updatedAt : new Date(updatedAt)
  const ms = then.getTime()
  if (!Number.isFinite(ms)) return ""

  const elapsed = now.getTime() - ms
  if (elapsed < DAY) return "today"
  if (elapsed < 2 * DAY) return "yesterday"

  const days = Math.floor(elapsed / DAY)
  if (days < 7) return `${days}d ago`
  if (days < 35) return `${Math.round(days / 7)}w ago`
  if (days < 365) return `${Math.round(days / 30)}mo ago`
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
