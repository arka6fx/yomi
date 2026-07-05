import { createHash } from "node:crypto"
import { generateText } from "ai"
import { createModel } from "@yomi/agent-core"

const SEARCH_LIMIT = 8

type CloudSearchSnippet = {
  sourceName: string
  title: string
  content: string
  score: number
  marker: number
}

type SyncResponse = {
  synced?: number
  removed?: number
}

type CloudMemoryEntry = {
  kind: string
  topic: string
  content: string
  confidence: number
  sourcePath?: string | null
  matchedBy?: string[]
  score?: number
  updatedAt?: string
}

type CloudMemoryProfile = {
  profile?: {
    static?: string[]
    dynamic?: string[]
  }
}

type ExtractedMemory = {
  kind: "preference" | "fact" | "project" | "decision" | "open_thread" | "correction"
  scope?: string
  topic: string
  content: string
  confidence?: number
  replaces_topic?: string
}

function backendBaseUrl(): string {
  return process.env["YOMI_BACKEND_URL"] ?? process.env["BACKEND_URL"] ?? "http://localhost:3001"
}

function sessionToken(): string {
  return process.env["YOMI_SESSION_TOKEN"] ?? ""
}

function authHeaders(): Record<string, string> {
  const token = sessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(`${backendBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) return null
  return (await res.json()) as T
}

export function scheduleCloudRagSync(_reason = "change"): void {
  return
}

export async function performCloudRagSync(): Promise<void> {
  return
}

export async function performCloudMemorySync(): Promise<void> {
  return
}

function parseMemories(text: string): ExtractedMemory[] {
  try {
    const parsed = JSON.parse(text) as { memories?: ExtractedMemory[] }
    return Array.isArray(parsed.memories) ? parsed.memories : []
  } catch {
    return []
  }
}

function cleanTurnText(value: string, max = 1800): string {
  return value
    .replace(/\r/g, "")
    .replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g, "[redacted image]")
    .replace(/[A-Za-z0-9+/=]{400,}/g, "[redacted base64]")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, max)
    .trim()
}

export async function captureCloudMemory(turn: {
  input: string
  output: string
  mode?: string
  sourcePath?: string
}): Promise<void> {
  if (!sessionToken()) return
  const input = cleanTurnText(turn.input)
  const output = cleanTurnText(turn.output)
  if (!input || !output) return

  const model =
    process.env["MEMORY_EXTRACTION_MODEL"] || process.env["AI_CREDITS_FAST_MODEL"] || "gpt-5.5-mini"
  const { text } = await generateText({
    model: createModel(model),
    messages: [
      {
        role: "user",
        content: `Extract durable user memory from this Yomi interaction.

Return strict JSON only:
{"memories":[{"kind":"preference|fact|project|decision|open_thread|correction","scope":"global|project|app|session","topic":"short key","content":"one concise memory","confidence":0.0,"replaces_topic":"optional old topic"}]}

Rules:
- Store only useful future context.
- Do not store screenshots, audio, base64, secrets, passwords, or one-off trivia.
- Prefer high precision. If uncertain, omit it.
- Use replaces_topic only for clear corrections or updates.

User: ${input}
Assistant: ${output}`,
      },
    ],
  })

  const memories = parseMemories(text)
  if (!memories.length) return
  await fetchJson<SyncResponse>("/api/memory/sync", {
    method: "POST",
    body: JSON.stringify({
      memories: memories.map((memory) => ({
        customId: `turn:${createHash("sha256").update(`${memory.kind}\0${memory.topic}\0${memory.content}`).digest("hex")}`,
        kind: memory.kind,
        scope: memory.scope ?? "global",
        topic: memory.topic,
        content: memory.content,
        confidence: Math.round(Math.max(0, Math.min(1, memory.confidence ?? 0.7)) * 100),
        sourceType: "sidecar_turn",
        sourcePath: turn.sourcePath,
        isStatic: memory.kind === "preference" || memory.kind === "fact",
      })),
    }),
  })
}

export async function retrieveCloudMemoryContext(query: string, maxChars = 3000): Promise<string> {
  if (!sessionToken()) return ""
  try {
    const data = await fetchJson<{ memories?: CloudMemoryEntry[] }>("/api/memory/search", {
      method: "POST",
      body: JSON.stringify({ query, limit: SEARCH_LIMIT, maxChars }),
    })
    const memories = data?.memories ?? []
    // Temporal decay: score = baseScore * e^(-λ * ageDays), λ = ln(2)/30 (30-day half-life)
    const now = Date.now()
    const halfLifeDays = 30
    const lambda = Math.LN2 / halfLifeDays
    const scored = memories.map((row) => {
      const ageDays = row.updatedAt ? (now - new Date(row.updatedAt).getTime()) / 86400000 : 0
      const decay = Math.exp(-lambda * Math.max(0, ageDays))
      return { ...row, _decayedScore: (row.score ?? 50) * decay }
    })
    scored.sort((a, b) => b._decayedScore - a._decayedScore)

    const out: string[] = []
    let used = 0
    for (const row of scored) {
      const matched = row.matchedBy?.length ? ` (${row.matchedBy.join("+")})` : ""
      const snippet = `- [${row.kind}${matched}, confidence ${row.confidence}] ${row.topic}: ${row.content}${row.sourcePath ? ` (source: ${row.sourcePath})` : ""}`
      if (used + snippet.length > maxChars) break
      out.push(snippet)
      used += snippet.length
    }
    return out.join("\n")
  } catch (err) {
    console.warn(
      "[yomi/cloud-rag] memory context retrieval failed:",
      err instanceof Error ? err.message : err,
    )
    return ""
  }
}

export async function retrieveCloudMemoryProfile(
  query: string,
  maxChars = 2500,
): Promise<{ staticProfile: string; dynamicProfile: string }> {
  if (!sessionToken()) return { staticProfile: "", dynamicProfile: "" }
  let data: CloudMemoryProfile | null = null
  try {
    data = await fetchJson<CloudMemoryProfile>("/api/memory/profile", {
      method: "POST",
      body: JSON.stringify({ query, limit: 32 }),
    })
  } catch (err) {
    console.warn(
      "[yomi/cloud-rag] memory profile retrieval failed:",
      err instanceof Error ? err.message : err,
    )
    return { staticProfile: "", dynamicProfile: "" }
  }
  const staticFacts = data?.profile?.static ?? []
  const dynamicFacts = data?.profile?.dynamic ?? []
  const format = (title: string, facts: string[]) => {
    const lines: string[] = []
    let used = 0
    for (const fact of facts) {
      const line = `- ${fact}`
      if (used + line.length > maxChars) break
      lines.push(line)
      used += line.length
    }
    return lines.length ? `${title}\n${lines.join("\n")}` : ""
  }
  return {
    staticProfile: format("## Static Profile", staticFacts),
    dynamicProfile: format("## Dynamic Context", dynamicFacts),
  }
}

async function searchCloudRag(query: string, maxChars: number): Promise<string> {
  if (!sessionToken()) return ""

  try {
    const data = await fetchJson<{ snippets?: CloudSearchSnippet[] }>("/api/rag/search", {
      method: "POST",
      body: JSON.stringify({ query, limit: SEARCH_LIMIT, maxChars }),
    })
    const snippets = data?.snippets ?? []
    if (!snippets.length) return ""

    // Numbered, attributed blocks so the model can cite sources inline as [n].
    const out: string[] = []
    let used = 0
    for (const row of snippets) {
      const marker = row.marker ?? out.length + 1
      const header = `[${marker}] ${row.sourceName}${row.title && row.title !== row.sourceName ? ` — ${row.title}` : ""}`
      const block = `${header}\n${row.content}`
      if (used + block.length > maxChars) break
      out.push(block)
      used += block.length
    }
    return out.join("\n\n")
  } catch (err) {
    console.warn("[yomi/cloud-rag] search failed:", err instanceof Error ? err.message : err)
    return ""
  }
}

export async function retrieveCloudRagContext(query: string, maxChars = 3000): Promise<string> {
  const cloud = await searchCloudRag(query, maxChars)
  if (cloud) return cloud
  return ""
}
