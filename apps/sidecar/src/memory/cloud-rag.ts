import { createHash } from "node:crypto"
import { retrieveLocalRagContext, scanArchiveSources, type ArchiveSource } from "./local-rag.js"

const MIRROR_SOURCE_TYPE = "mirror"
const SYNC_DEBOUNCE_MS = 1000
const SEARCH_LIMIT = 8

type CloudSource = {
  id: string
  name: string
  sourceType: string
  status: string
  updatedAt?: string
}

type CloudSearchSnippet = {
  sourceName: string
  title: string
  content: string
  score: number
}

type SyncResponse = {
  synced?: number
  removed?: number
}

let syncTimer: ReturnType<typeof setTimeout> | null = null
let syncInFlight: Promise<void> | null = null
let syncFollowUp = false

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

function cloudHash(source: ArchiveSource): string {
  return createHash("sha256").update(`${source.path}\0${source.content}`).digest("hex")
}

function encodeSources(sources: ArchiveSource[]) {
  return sources.map((source) => ({
    path: source.path,
    title: source.title,
    content: source.content,
    contentHash: cloudHash(source),
    updatedAt: source.updatedAt,
  }))
}

function scheduleLater(): void {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = null
    void performCloudRagSync()
  }, SYNC_DEBOUNCE_MS)
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
  return await res.json() as T
}

async function fetchRemoteMirrorSources(): Promise<CloudSource[]> {
  const data = await fetchJson<{ sources?: CloudSource[] }>("/api/rag/sources")
  return (data?.sources ?? []).filter((source) => source.sourceType === MIRROR_SOURCE_TYPE)
}

export function scheduleCloudRagSync(reason = "change"): void {
  if (!sessionToken()) return
  scheduleLater()
}

export async function performCloudRagSync(): Promise<void> {
  const token = sessionToken()
  if (!token) return

  if (syncInFlight) {
    syncFollowUp = true
    return syncInFlight
  }

  const run = (async () => {
    try {
      const localSources = await scanArchiveSources()
      const remoteSources = await fetchRemoteMirrorSources().catch(() => [])
      const currentPaths = new Set(localSources.map((source) => source.path))
      const removedPaths = remoteSources.map((source) => source.name).filter((name) => !currentPaths.has(name))

      const payload = {
        sources: encodeSources(localSources),
        removedPaths,
      }
      const response = await fetchJson<SyncResponse>("/api/rag/sync", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      if (!response) {
        throw new Error("Cloud RAG sync failed")
      }
    } catch (err) {
      console.warn("[yomi/cloud-rag] sync failed:", err instanceof Error ? err.message : err)
    }
  })()

  syncInFlight = run
  try {
    await run
  } finally {
    syncInFlight = null
    if (syncFollowUp) {
      syncFollowUp = false
      scheduleLater()
    }
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

    const out: string[] = []
    let used = 0
    for (const row of snippets) {
      const snippet = `- ${row.sourceName}: ${row.content}`
      if (used + snippet.length > maxChars) break
      out.push(snippet)
      used += snippet.length
    }
    return out.join("\n")
  } catch (err) {
    console.warn("[yomi/cloud-rag] search failed:", err instanceof Error ? err.message : err)
    return ""
  }
}

export async function retrieveCloudRagContext(query: string, maxChars = 3000): Promise<string> {
  const cloud = await searchCloudRag(query, maxChars)
  if (cloud) return cloud
  return await retrieveLocalRagContext(query, maxChars)
}
