// Local KV store for recall frequency tracking and promotion candidate scoring.
// Persisted as JSON in the notepad directory. Inspired by OpenClaw's short-term recall store.

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import { notepadDir } from "./loader.js"

export type RecallEntry = {
  key: string
  kind: string
  topic: string
  content: string
  sourcePath?: string
  recallCount: number
  totalScore: number
  maxScore: number
  firstRecalledAt: string
  lastRecalledAt: string
  queryHashes: string[]
  recallDays: string[]
  promotedAt?: string
}

export type RecallStore = {
  entries: Record<string, RecallEntry>
  version: number
}

const CURRENT_VERSION = 1

function storePath(): string {
  return join(notepadDir(), "recall-store.json")
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function hashQuery(q: string): string {
  let h = 0
  for (let i = 0; i < q.length; i++) {
    h = ((h << 5) - h + q.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

let _cache: RecallStore | null = null

async function load(): Promise<RecallStore> {
  if (_cache) return _cache
  try {
    const data = await readFile(storePath(), "utf-8")
    _cache = JSON.parse(data) as RecallStore
    return _cache
  } catch {
    _cache = { entries: {}, version: CURRENT_VERSION }
    return _cache
  }
}

async function save(): Promise<void> {
  if (!_cache) return
  const path = storePath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(_cache, null, 2), "utf-8")
}

export function makeKey(kind: string, topic: string): string {
  return `${kind}::${topic.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 80)}`
}

export async function recordRecall(
  kind: string,
  topic: string,
  content: string,
  query: string,
  score: number,
  sourcePath?: string,
): Promise<void> {
  const store = await load()
  const key = makeKey(kind, topic)
  const now = new Date().toISOString()
  const qHash = hashQuery(query)
  const day = today()

  let entry = store.entries[key]
  if (!entry) {
    entry = {
      key,
      kind,
      topic,
      content,
      sourcePath,
      recallCount: 0,
      totalScore: 0,
      maxScore: 0,
      firstRecalledAt: now,
      lastRecalledAt: now,
      queryHashes: [],
      recallDays: [],
    }
    store.entries[key] = entry
  }

  entry.recallCount++
  entry.totalScore += score
  entry.maxScore = Math.max(entry.maxScore, score)
  entry.lastRecalledAt = now
  entry.content = content

  if (!entry.queryHashes.includes(qHash)) {
    entry.queryHashes.push(qHash)
    if (entry.queryHashes.length > 32) entry.queryHashes = entry.queryHashes.slice(-32)
  }

  if (!entry.recallDays.includes(day)) {
    entry.recallDays.push(day)
    if (entry.recallDays.length > 16) entry.recallDays = entry.recallDays.slice(-16)
  }

  await save()
}

export async function getPromotionCandidates(minScore = 0.75, minRecalls = 3): Promise<RecallEntry[]> {
  const store = await load()
  const now = Date.now()
  const candidates: { entry: RecallEntry; score: number }[] = []

  for (const entry of Object.values(store.entries)) {
    if (entry.promotedAt) continue
    if (entry.recallCount < minRecalls) continue

    const freq = Math.log1p(entry.recallCount) / Math.log1p(10)
    const avgScore = entry.totalScore / Math.max(1, entry.recallCount)
    const uniqueQueries = entry.queryHashes.length
    const uniqueDays = entry.recallDays.length
    const diversity = Math.max(uniqueQueries, uniqueDays) / 5
    const ageDays = (now - new Date(entry.lastRecalledAt).getTime()) / 86400000
    const recency = Math.exp(-(Math.LN2 / 14) * Math.max(0, ageDays))

    const score = 0.24 * freq + 0.3 * avgScore + 0.15 * Math.min(1, diversity) + 0.15 * recency

    if (score >= minScore && uniqueQueries >= 2) {
      candidates.push({ entry, score })
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .map((c) => c.entry)
}

export async function markPromoted(key: string): Promise<void> {
  const store = await load()
  if (store.entries[key]) {
    store.entries[key].promotedAt = new Date().toISOString()
    await save()
  }
}

export async function pruneStaleRecalls(maxAgeDays = 60): Promise<number> {
  const store = await load()
  const cutoff = Date.now() - maxAgeDays * 86400000
  const before = Object.keys(store.entries).length
  for (const [key, entry] of Object.entries(store.entries)) {
    if (new Date(entry.lastRecalledAt).getTime() < cutoff && !entry.promotedAt) {
      delete store.entries[key]
    }
  }
  await save()
  return before - Object.keys(store.entries).length
}

export async function getRecallStats(): Promise<{ total: number; promoted: number; stalePruned: number }> {
  const store = await load()
  const entries = Object.values(store.entries)
  return {
    total: entries.length,
    promoted: entries.filter((e) => e.promotedAt).length,
    stalePruned: 0,
  }
}

export function resetRecallCache(): void {
  _cache = null
}
