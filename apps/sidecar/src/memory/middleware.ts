// Memory injection middleware for transparent memory augmentation.
// Intercepts LLM calls to inject relevant memories into the system prompt.
// Inspired by Supermemory's withSupermemory Proxy pattern.

import { retrieveCloudMemoryContext, retrieveCloudMemoryProfile } from "./cloud-rag.js"
import { getPromotedContent } from "./promotion.js"

export type MemoryMode = "profile" | "query" | "full"

export type MemoryMiddlewareConfig = {
  mode: MemoryMode
  profileMaxChars?: number
  contextMaxChars?: number
  timeoutMs?: number
  skipOnError?: boolean
}

const DEFAULT_CONFIG: MemoryMiddlewareConfig = {
  mode: "full",
  profileMaxChars: 2500,
  contextMaxChars: 3500,
  timeoutMs: 5000,
  skipOnError: true,
}

// Per-turn LRU cache to avoid redundant memory fetches during tool-call loops.
// Inspired by Supermemory's MemoryCache.
class MemoryCache {
  private cache = new Map<string, { data: unknown; expiry: number }>()
  private maxSize = 100

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiry) {
      this.cache.delete(key)
      return undefined
    }
    return entry.data as T
  }

  set<T>(key: string, data: T, ttlMs = 30000): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }
    this.cache.set(key, { data, expiry: Date.now() + ttlMs })
  }

  clear(): void {
    this.cache.clear()
  }
}

const turnCache = new MemoryCache()

function makeCacheKey(
  containerTag: string,
  threadId: string,
  mode: string,
  message: string,
): string {
  return `${containerTag}:${threadId}:${mode}:${message.slice(0, 100)}`
}

// Format memories into a markdown block for system prompt injection.
function formatMemoriesForPrompt(
  durableMemory: string,
  staticProfile: string,
  dynamicProfile: string,
  promotedMemory: string,
): string {
  const parts: string[] = []

  if (staticProfile) {
    parts.push(`<static_profile>\n${staticProfile.trim()}\n</static_profile>`)
  }

  if (dynamicProfile) {
    parts.push(`<dynamic_profile>\n${dynamicProfile.trim()}\n</dynamic_profile>`)
  }

  if (promotedMemory && promotedMemory.length > 200) {
    const summary = promotedMemory
      .split("\n")
      .filter((l) => l.startsWith("- [") || l.startsWith("**Topic:"))
      .slice(0, 10)
      .join("\n")
    if (summary) {
      parts.push(`<promoted_memories>\n${summary}\n</promoted_memories>`)
    }
  }

  if (durableMemory) {
    parts.push(`<durable_memories>\n${durableMemory.trim()}\n</durable_memories>`)
  }

  if (!parts.length) return ""

  return [
    `<memory>`,
    `[System note: Retrieved context for this turn. Use as reference only.]`,
    ...parts,
    `</memory>`,
  ].join("\n")
}

// Fetch and cache memories for a given query.
async function fetchMemories(query: string, config: MemoryMiddlewareConfig): Promise<string> {
  const cacheKey = makeCacheKey("default", "current", config.mode, query)
  const cached = turnCache.get<string>(cacheKey)
  if (cached) return cached

  const timeout = (ms: number) =>
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))

  try {
    const [durableMemory, profile, promotedMemory] = await Promise.race([
      Promise.all([
        config.mode === "profile"
          ? Promise.resolve("")
          : retrieveCloudMemoryContext(query, config.contextMaxChars),
        retrieveCloudMemoryProfile(query, config.profileMaxChars),
        config.mode === "query" ? Promise.resolve("") : getPromotedContent(2000),
      ]),
      timeout(config.timeoutMs ?? 5000),
    ])

    const formatted = formatMemoriesForPrompt(
      durableMemory,
      profile.staticProfile,
      profile.dynamicProfile,
      promotedMemory,
    )

    turnCache.set(cacheKey, formatted)
    return formatted
  } catch {
    if (config.skipOnError) return ""
    throw new Error("Memory retrieval failed")
  }
}

// Inject memories into system prompt.
// This is the core middleware function — call before building the system prompt.
export async function injectMemoriesIntoSystemPrompt(
  systemPrompt: string,
  query: string,
  config: Partial<MemoryMiddlewareConfig> = {},
): Promise<string> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const memoryBlock = await fetchMemories(query, cfg)
  if (!memoryBlock) return systemPrompt

  return `${systemPrompt}\n\n${memoryBlock}`
}

// Deduplicate memories across sources with priority: static > dynamic > search.
export function deduplicateMemories(
  staticFacts: string[],
  dynamicFacts: string[],
  searchResults: string[],
): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  const addIfNew = (items: string[]) => {
    for (const item of items) {
      const normalized = item.toLowerCase().replace(/\s+/g, " ").trim()
      if (!seen.has(normalized)) {
        seen.add(normalized)
        result.push(item)
      }
    }
  }

  addIfNew(staticFacts)
  addIfNew(dynamicFacts)
  addIfNew(searchResults)

  return result
}

export function clearMemoryCache(): void {
  turnCache.clear()
}
