// Procedural Memory — stores successful UIA automation strategies and recalls them.
// Learns from successful operations, improves future planning.
// Hermes-inspired skills memory + LangGraph knowledge learning.

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

// ===========================================================================
// Types
// ===========================================================================

export interface Strategy {
  app: string
  goal: string
  method: string // e.g. "Ctrl+L → type → Enter", "invoke_element", "coordinate_click"
  elementPattern?: { role: string; nameRegex: string; automationId?: string }
  confidence: number // 0..1, updated with each success/failure
  successCount: number
  failureCount: number
  lastUsed: number // Date.now()
  avgDurationMs: number
}

interface StrategyStore {
  version: 2
  strategies: Strategy[]
}

// ===========================================================================
// Storage
// ===========================================================================

const STRATEGY_DIR = join(homedir(), ".yomi", "strategies")
const STRATEGY_FILE = join(STRATEGY_DIR, "strategies.json")

async function loadStore(): Promise<StrategyStore> {
  try {
    const raw = await readFile(STRATEGY_FILE, "utf8")
    const store = JSON.parse(raw) as StrategyStore
    if (store.version === 2 && Array.isArray(store.strategies)) return store
  } catch { /* file doesn't exist or corrupt */ }
  return { version: 2, strategies: [] }
}

async function saveStore(store: StrategyStore): Promise<void> {
  await mkdir(STRATEGY_DIR, { recursive: true })
  await writeFile(STRATEGY_FILE, JSON.stringify(store, null, 2), "utf8")
}

// In-memory cache
let cache: StrategyStore | null = null

async function getStore(): Promise<StrategyStore> {
  if (!cache) cache = await loadStore()
  return cache
}

// ===========================================================================
// CRUD
// ===========================================================================

export async function rememberStrategy(strat: Omit<Strategy, "successCount" | "failureCount" | "lastUsed" | "avgDurationMs">): Promise<Strategy> {
  const store = await getStore()
  const existing = store.strategies.find((s) => s.app === strat.app && s.goal === strat.goal && s.method === strat.method)

  if (existing) {
    existing.confidence = Math.min(1, existing.confidence + 0.05)
    existing.successCount++
    existing.lastUsed = Date.now()
    existing.elementPattern = strat.elementPattern || existing.elementPattern
  } else {
    const entry: Strategy = {
      ...strat,
      confidence: 0.6, // initial confidence for new strategies
      successCount: 1,
      failureCount: 0,
      lastUsed: Date.now(),
      avgDurationMs: 0,
    }
    store.strategies.push(entry)
  }

  store.strategies.sort((a, b) => b.lastUsed - a.lastUsed)
  await saveStore(store)
  cache = null // invalidate
  return existing || store.strategies[store.strategies.length - 1]
}

export async function recallBestStrategy(app: string, goal: string): Promise<Strategy | null> {
  const store = await getStore()
  const candidates = store.strategies
    .filter((s) => s.app === app && s.goal === goal)
    .sort((a, b) => b.confidence - a.confidence || b.successCount - a.successCount)
  return candidates[0] ?? null
}

export async function recallAllStrategies(app: string): Promise<Strategy[]> {
  const store = await getStore()
  return store.strategies.filter((s) => s.app === app)
}

export async function recordFailure(app: string, goal: string, method: string): Promise<void> {
  const store = await getStore()
  const strat = store.strategies.find((s) => s.app === app && s.goal === goal && s.method === method)
  if (strat) {
    strat.failureCount++
    strat.confidence = Math.max(0.1, strat.confidence - 0.1)
    await saveStore(store)
    cache = null
  }
}

export async function recordDuration(app: string, goal: string, method: string, durationMs: number): Promise<void> {
  const store = await getStore()
  const strat = store.strategies.find((s) => s.app === app && s.goal === goal && s.method === method)
  if (strat) {
    const n = strat.successCount
    strat.avgDurationMs = Math.round((strat.avgDurationMs * (n - 1) + durationMs) / n)
    await saveStore(store)
    cache = null
  }
}

export async function getStrategyStats(): Promise<{ total: number; byApp: Record<string, number> }> {
  const store = await getStore()
  const byApp: Record<string, number> = {}
  for (const s of store.strategies) {
    byApp[s.app] = (byApp[s.app] || 0) + 1
  }
  return { total: store.strategies.length, byApp }
}
