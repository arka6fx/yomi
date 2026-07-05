import { jsonSchema, tool } from "ai"

type MemoryEntry = {
  id: string
  kind: string
  scope: string
  topic: string
  content: string
  confidence: number
  sourceType?: string | null
  sourcePath?: string | null
  customId?: string | null
  summary?: string | null
  isStatic?: boolean
  updatedAt?: string
}

function backendBaseUrl(): string {
  return process.env["YOMI_BACKEND_URL"] ?? process.env["BACKEND_URL"] ?? "http://localhost:3001"
}

function sessionToken(): string {
  return process.env["YOMI_SESSION_TOKEN"] ?? ""
}

async function memoryRequest<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const token = sessionToken()
  if (!token) return null
  const res = await fetch(`${backendBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) return null
  return (await res.json()) as T
}

async function memoryGet<T>(path: string): Promise<T | null> {
  const token = sessionToken()
  if (!token) return null
  const res = await fetch(`${backendBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  return (await res.json()) as T
}

export function createMemoryTools() {
  return {
    add_memory: tool({
      description:
        "Store a durable memory fact, preference, decision, project note, or open thread in Yomi's canonical backend memory store.",
      parameters: jsonSchema<{
        content: string
        customId?: string
        topic?: string
        summary?: string
        kind?: "preference" | "fact" | "project" | "decision" | "open_thread" | "correction"
        scope?: string
        confidence?: number
        sourcePath?: string
        isStatic?: boolean
        forgetAfter?: string
      }>({
        type: "object",
        properties: {
          content: { type: "string", description: "The memory content to remember" },
          customId: { type: "string", description: "Stable id for idempotent upserts" },
          topic: { type: "string", description: "Short title for the memory" },
          summary: { type: "string", description: "Optional short summary" },
          kind: { type: "string", description: "Memory category" },
          scope: {
            type: "string",
            description: "Project, person, app, or global scope",
            default: "global",
          },
          confidence: { type: "number", description: "Confidence from 0 to 100", default: 80 },
          sourcePath: { type: "string", description: "Optional source identifier" },
          isStatic: { type: "boolean", description: "Whether this is stable profile memory" },
          forgetAfter: {
            type: "string",
            description: "Optional ISO timestamp after which to forget",
          },
        },
        required: ["content"],
      }),
      execute: async ({
        content,
        customId,
        topic,
        summary,
        kind = "fact",
        scope = "global",
        confidence = 80,
        sourcePath,
        isStatic,
        forgetAfter,
      }) => {
        const result = await memoryRequest<{ memory?: MemoryEntry }>("/api/memory/add", {
          content,
          customId,
          topic,
          summary,
          kind,
          scope,
          confidence,
          sourceType: "agent_tool",
          sourcePath,
          isStatic,
          forgetAfter,
        })
        if (!result?.memory)
          return { error: "Memory store unavailable. Sign in to sync durable memories." }
        return { ok: true, memory: result.memory }
      },
    }),

    list_memories: tool({
      description:
        "List recent active durable memories from Yomi's canonical backend memory store.",
      parameters: jsonSchema<{ limit?: number }>({
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum entries to return", default: 50 },
        },
        required: [],
      }),
      execute: async ({ limit = 50 }) => {
        const data = await memoryGet<{ memories?: MemoryEntry[] }>(
          `/api/memory/entries?limit=${encodeURIComponent(String(limit))}`,
        )
        return data?.memories?.length ? data.memories : { message: "No cloud memories found." }
      },
    }),

    retrieve_memory: tool({
      description:
        "Retrieve relevant durable memories from Yomi's backend memory store. Use before answering when user asks about preferences, prior decisions, projects, or remembered facts.",
      parameters: jsonSchema<{ query: string; limit?: number }>({
        type: "object",
        properties: {
          query: { type: "string", description: "Memory search query" },
          limit: { type: "number", description: "Maximum memory entries to return", default: 8 },
        },
        required: ["query"],
      }),
      execute: async ({ query, limit = 8 }) => {
        const result = await memoryRequest<{ memories?: MemoryEntry[] }>("/api/memory/search", {
          query,
          limit,
          maxChars: 4000,
        })
        return result?.memories?.length ? result.memories : { message: "No memories found." }
      },
    }),

    delete_memory: tool({
      description:
        "Forget/delete matching memories from Yomi's backend memory store. Use when the user asks to forget, remove, or correct remembered information.",
      parameters: jsonSchema<{ id?: string; customId?: string; query?: string; hard?: boolean }>({
        type: "object",
        properties: {
          id: { type: "string", description: "Exact memory id to forget" },
          customId: { type: "string", description: "Stable custom memory id to forget" },
          query: { type: "string", description: "Topic/content search if id is unknown" },
          hard: { type: "boolean", description: "Permanently delete instead of soft-forgetting" },
        },
        required: [],
      }),
      execute: async ({ id, customId, query, hard }) => {
        if (!id && !customId && !query) return { error: "Provide id, customId, or query." }
        const result = await memoryRequest<{
          forgotten?: number
          deleted?: number
          ids?: string[]
        }>("/api/memory/forget", {
          id,
          customId,
          query,
          hard,
        })
        return result
          ? { ok: true, ...result }
          : { error: "Memory store unavailable. Sign in to manage durable memories." }
      },
    }),

    walk_memory_graph: tool({
      description:
        "Walk the memory knowledge graph from a root memory to discover related memories via updates/extends/derives relations. Use when you need to understand how memories are connected or find the version history of a fact.",
      parameters: jsonSchema<{ rootId: string; maxDepth?: number }>({
        type: "object",
        properties: {
          rootId: { type: "string", description: "Root memory id to start the walk from" },
          maxDepth: {
            type: "number",
            description: "Maximum depth to walk (default 3, max 6)",
            default: 3,
          },
        },
        required: ["rootId"],
      }),
      execute: async ({ rootId, maxDepth = 3 }) => {
        const result = await memoryRequest<{
          root?: MemoryEntry
          chain?: MemoryEntry[]
          branched?: MemoryEntry[]
        }>("/api/memory/graph-walk", { rootId, maxDepth })
        if (!result) return { error: "Memory store unavailable." }
        const all = [result.root, ...(result.chain ?? []), ...(result.branched ?? [])].filter(
          Boolean,
        )
        return { memories: all }
      },
    }),

    memory_stats: tool({
      description:
        "Get memory system statistics: number of promoted memories, candidate entries, and MEMORY.md size.",
      parameters: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        required: [],
      }),
      execute: async () => {
        try {
          const { getMemoryStats } = await import("../memory/promotion.js")
          const stats = await getMemoryStats()
          return stats
        } catch {
          return { error: "Local memory unavailable." }
        }
      },
    }),
  }
}
