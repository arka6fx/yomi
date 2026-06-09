// System-prompt injection for procedural-memory skills. Reads the skill
// index and formats it as a one-line-per-skill block the model can scan in
// a single eye-pass. Per the spec's progressive-disclosure rule: the
// metadata block is always present, full bodies are loaded on demand via
// `skill_view`.
//
// Output is deterministic and small — we cap at MAX_INDEX_LINES so a
// pathological number of skills never blows the cached prefix budget.

import { listSkills } from "./skill-store.js"
import { getUsage } from "./skill-usage.js"
import type { SkillSummary } from "./skill-types.js"

const MAX_INDEX_LINES = 20
// Hermes' skill-authoring standard: description ≤ 60 chars in the index
// line. We truncate aggressively so a verbose description can't dominate
// the prompt. The full description still lives in the manifest; skill_view
// returns it.
const DESCRIPTION_LIMIT = 60

function truncateDescription(description: string): string {
  const trimmed = description.trim().replace(/\s+/g, " ")
  if (trimmed.length <= DESCRIPTION_LIMIT) return trimmed
  return trimmed.slice(0, DESCRIPTION_LIMIT - 1).trimEnd() + "…"
}

function formatLine(
  summary: SkillSummary,
  extras: { lastActivityAt: string | null; useCount: number },
): string {
  const desc = truncateDescription(summary.description)
  // Sort key for deterministic ordering: most-recently-used first, then
  // name. Pinned skills float to the top.
  const ageLabel = extras.lastActivityAt
    ? new Date(extras.lastActivityAt).toISOString().slice(0, 10)
    : "new"
  const flag = summary.pinned ? "📌" : "  "
  return `${flag} ${summary.name} — ${desc} (used ${extras.useCount}×, last ${ageLabel})`
}

export interface SkillIndexEntry {
  summary: SkillSummary
  lastActivityAt: string | null
  useCount: number
}

export async function loadSkillIndex(opts: { cap?: number } = {}): Promise<SkillIndexEntry[]> {
  const cap = opts.cap ?? MAX_INDEX_LINES
  const all = await listSkills()
  const entries: SkillIndexEntry[] = []
  for (const e of all) {
    if (!e.manifest) continue
    const usage = await getUsage(e.summary.name)
    entries.push({
      summary: e.summary,
      lastActivityAt: usage.last_activity_at,
      useCount: usage.use_count,
    })
  }
  // Sort: pinned first, then most-recently-used, then by name.
  entries.sort((a, b) => {
    if (a.summary.pinned !== b.summary.pinned) {
      return a.summary.pinned ? -1 : 1
    }
    const at = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0
    const bt = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0
    if (at !== bt) return bt - at
    return a.summary.name.localeCompare(b.summary.name)
  })
  return entries.slice(0, cap)
}

// Returns a fully formatted block, or an empty string when no skills exist.
// The caller (harness/prompt.ts) embeds it as one section in the prompt.
export async function buildSkillIndexBlock(opts: { cap?: number } = {}): Promise<string> {
  const entries = await loadSkillIndex(opts)
  if (entries.length === 0) return ""
  const lines = entries.map((e) => formatLine(e.summary, e))
  const header = `<skills>\nProcedural memory — call \`skill_view\` to load the full body of any skill below.\n`
  const footer = `\n</skills>`
  return header + lines.join("\n") + footer
}
