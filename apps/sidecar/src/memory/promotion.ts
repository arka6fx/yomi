// Short-term to long-term memory promotion engine.
// Tracks recall frequency and promotes frequently-accessed memories to MEMORY.md.
// Inspired by OpenClaw's short-term-promotion.ts.

import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { notepadDir } from "./loader.js"
import { getPromotionCandidates, markPromoted, pruneStaleRecalls, getRecallStats, resetRecallCache } from "./recall-store.js"
import { compactMemoryForBudget, rankMemoriesForContext, DEFAULT_BUDGET } from "./budget.js"

const PROMOTIONS_FILE = "MEMORY.md"

function promotionsPath(): string {
  return join(notepadDir(), PROMOTIONS_FILE)
}

export async function ensureMemoryFile(): Promise<void> {
  const path = promotionsPath()
  await mkdir(dirname(path), { recursive: true })
  try {
    await readFile(path, "utf-8")
  } catch {
    await writeFile(path, "# Long-Term Memory\n\n", "utf-8")
  }
}

export async function readMemoryFile(): Promise<string> {
  try {
    return await readFile(promotionsPath(), "utf-8")
  } catch {
    return "# Long-Term Memory\n\n"
  }
}

async function writeMemoryFile(content: string): Promise<void> {
  const path = promotionsPath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf-8")
}

export async function runPromotionCycle(opts?: {
  minScore?: number
  minRecalls?: number
  budgetChars?: number
}): Promise<{
  promoted: number
  candidates: number
  droppedDates: string[]
  pruned: number
}> {
  const budget = { ...DEFAULT_BUDGET, maxChars: opts?.budgetChars ?? DEFAULT_BUDGET.maxChars }
  const candidates = await getPromotionCandidates(opts?.minScore ?? 0.75, opts?.minRecalls ?? 3)

  let promoted = 0
  const droppedDates: string[] = []

  if (!candidates.length) {
    const pruned = await pruneStaleRecalls()
    return { promoted: 0, candidates: 0, droppedDates: [], pruned }
  }

  let memoryContent = await readMemoryFile()

  for (const candidate of candidates.slice(0, 5)) {
    const dateStr = new Date().toISOString().slice(0, 10)
    const section = [
      `## Promoted From Short-Term Memory (${dateStr})`,
      "",
      `**Kind:** ${candidate.kind}  `,
      `**Topic:** ${candidate.topic}  `,
      `**Recalls:** ${candidate.recallCount}  `,
      `**Score:** ${(candidate.totalScore / Math.max(1, candidate.recallCount)).toFixed(2)}  `,
      `**Content:** ${candidate.content}`,
      "",
    ].join("\n")

    const { compacted, droppedDates: dropped } = compactMemoryForBudget(memoryContent, section, budget)
    memoryContent = compacted
    droppedDates.push(...dropped)
    await markPromoted(candidate.key)
    promoted++
  }

  await writeMemoryFile(memoryContent)
  const pruned = await pruneStaleRecalls()
  resetRecallCache()

  return { promoted, candidates: candidates.length, droppedDates, pruned }
}

export async function getPromotedContent(maxChars = 5000): Promise<string> {
  try {
    const content = await readMemoryFile()
    if (content.length <= maxChars) return content
    return content.slice(0, Math.floor(maxChars * 0.5)) +
      `\n\n[...trimmed ${content.length - maxChars} chars...]\n\n` +
      content.slice(-Math.floor(maxChars * 0.3))
  } catch {
    return ""
  }
}

export async function appendToMemoryFile(turn: {
  input: string
  output: string
  summary?: string
}): Promise<void> {
  const dateStr = new Date().toISOString().slice(0, 10)
  const entry = [
    `### Session — ${new Date().toISOString()}`,
    `**You:** ${turn.input.slice(0, 200)}`,
    `**Yomi:** ${turn.summary || turn.output.slice(0, 200)}`,
    "",
  ].join("\n")

  const path = join(notepadDir(), "sessions", `session-${dateStr}.md`)
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, entry, "utf-8")
}

export async function getMemoryStats(): Promise<{
  promoted: number
  totalCandidates: number
  promotedSize: number
}> {
  const stats = await getRecallStats()
  const content = await readMemoryFile()
  return {
    promoted: stats.promoted,
    totalCandidates: stats.total,
    promotedSize: content.length,
  }
}
