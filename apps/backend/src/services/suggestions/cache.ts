import { eq } from "drizzle-orm"
import { db, generatedSuggestions } from "@yomi/db"
import type { SuggestionEntry } from "./catalog.js"
import type { GeneratedSuggestion } from "./assemble.js"

// TTL for the generated-suggestions cache. A cache older than this is served
// as-is but triggers an asynchronous regeneration for the next load (SWR).
const TTL_MS = 7 * 24 * 60 * 60 * 1000

interface GeneratedRow {
  dedupKey: string
  title: string
  description: string
  schedule: string
  prompt: string
  deliverTo: unknown
  connector: string
  distinctDays: number
  generatedAt: Date | string
}

// Reconstruct an offerable SuggestionEntry from a cached row. provider is the
// source connector so the shared offerable gating treats it like a catalog entry.
function rowToEntry(row: GeneratedRow): SuggestionEntry {
  const deliverTo = Array.isArray(row.deliverTo) ? (row.deliverTo as string[]) : []
  const entry: SuggestionEntry = {
    dedupKey: row.dedupKey,
    provider: row.connector,
    title: row.title,
    description: row.description,
    spec: { schedule: row.schedule, prompt: row.prompt, deliverTo },
  }
  if (deliverTo.includes("telegram")) entry.requires = { telegram: true }
  return entry
}

// Cached generated suggestions for a user, ranked strongest-first, plus whether
// the cache is missing or past TTL and should be asynchronously regenerated.
export async function readGeneratedCache(
  userId: string,
  now: Date = new Date(),
): Promise<{ entries: SuggestionEntry[]; stale: boolean }> {
  const rows = (await db
    .select({
      dedupKey: generatedSuggestions.dedupKey,
      title: generatedSuggestions.title,
      description: generatedSuggestions.description,
      schedule: generatedSuggestions.schedule,
      prompt: generatedSuggestions.prompt,
      deliverTo: generatedSuggestions.deliverTo,
      connector: generatedSuggestions.connector,
      distinctDays: generatedSuggestions.distinctDays,
      generatedAt: generatedSuggestions.generatedAt,
    })
    .from(generatedSuggestions)
    .where(eq(generatedSuggestions.userId, userId))) as GeneratedRow[]

  if (rows.length === 0) return { entries: [], stale: true }

  const newest = rows.reduce((max, r) => Math.max(max, new Date(r.generatedAt).getTime()), 0)
  const stale = now.getTime() - newest > TTL_MS
  // Rank in code (strongest evidence first) rather than trusting DB row order.
  const ranked = [...rows].sort((a, b) => b.distinctDays - a.distinctDays)
  return { entries: ranked.map(rowToEntry), stale }
}

// Resolve a single generated dedupKey from the user's cache — the generated-key
// arm of findEntry, so accept/dismiss operate on it like a catalog key.
export async function findGeneratedEntry(
  userId: string,
  dedupKey: string,
): Promise<SuggestionEntry | undefined> {
  const { entries } = await readGeneratedCache(userId)
  return entries.find((e) => e.dedupKey === dedupKey)
}

// Replace the user's cached generated suggestions with a fresh set. Delete-then-
// insert keeps the cache a faithful snapshot of the latest generation (an empty
// set legitimately clears stale suggestions when nothing is earned anymore).
export async function writeGeneratedCache(
  userId: string,
  suggestions: GeneratedSuggestion[],
): Promise<void> {
  await db.delete(generatedSuggestions).where(eq(generatedSuggestions.userId, userId))
  if (suggestions.length === 0) return
  await db.insert(generatedSuggestions).values(
    suggestions.map((s) => ({
      userId,
      dedupKey: s.dedupKey,
      title: s.title,
      description: s.description,
      schedule: s.spec.schedule,
      prompt: s.spec.prompt,
      deliverTo: s.spec.deliverTo,
      connector: s.connector,
      timeBucket: s.timeBucket,
      distinctDays: s.distinctDays,
    })),
  )
}
