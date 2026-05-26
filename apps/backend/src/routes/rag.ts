import { createHash } from "node:crypto"
import { Hono } from "hono"
import { and, eq, sql } from "drizzle-orm"
import {
  db,
  ragChunks,
  ragDocuments,
  ragEmbeddings,
  ragRetrievalLogs,
  ragSources,
} from "@yomi/db"
import type { CloudRagSnippet } from "@yomi/shared"
import type { RagSourceInfo } from "@yomi/shared"
import { authenticate } from "../auth.js"
import { effectivePlanForUser, isOwnerUser } from "../entitlements.js"

const EMBEDDING_MODEL = process.env["EMBEDDING_MODEL"] ?? "text-embedding-3-small"
const EMBEDDING_DIMENSIONS = 1536
const MAX_DOCUMENT_CHARS = 120_000
const CHUNK_CHARS = 1800
const CHUNK_OVERLAP = 220

type CreateSourceBody = {
  name?: string
  sourceType?: string
}

type CreateDocumentBody = {
  sourceId?: string
  title?: string
  mimeType?: string
  content?: string
  metadata?: Record<string, unknown>
}

type SearchBody = {
  query?: string
  limit?: number
  maxChars?: number
}

export const ragRouter = new Hono()

function ragAllowed(user: { plan?: string | null; role?: string | null; email?: string | null; id?: string | null }): boolean {
  const plan = effectivePlanForUser(user)
  return isOwnerUser(user) || plan === "pro" || plan === "max"
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function clean(value: string, max: number): string {
  return value
    .replace(/\r/g, "")
    .replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g, "[redacted image]")
    .replace(/[A-Za-z0-9+/=]{400,}/g, "[redacted base64]")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, max)
    .trim()
}

function chunkText(content: string): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < content.length) {
    const end = Math.min(content.length, start + CHUNK_CHARS)
    const chunk = content.slice(start, end).trim()
    if (chunk) chunks.push(chunk)
    if (end === content.length) break
    start = Math.max(0, end - CHUNK_OVERLAP)
  }
  return chunks
}

function embeddingUrl(): string {
  const base = process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1"
  return `${base.replace(/\/$/, "")}/embeddings`
}

async function embedText(input: string): Promise<number[]> {
  const apiKey = process.env["OPENAI_API_KEY"]
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")
  const res = await fetch(embeddingUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  })
  if (!res.ok) throw new Error(`Embedding request failed (${res.status})`)
  const data = await res.json() as { data?: { embedding?: number[] }[] }
  const embedding = data.data?.[0]?.embedding
  if (!embedding?.length) throw new Error("Embedding response was empty")
  return embedding
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((v) => Number.isFinite(v) ? v.toFixed(8) : "0").join(",")}]`
}

ragRouter.use("*", authenticate)

ragRouter.post("/sources", async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user)) return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)

  const body = await c.req.json().catch(() => ({})) as CreateSourceBody
  const name = clean(body.name ?? "", 120)
  const sourceType = clean(body.sourceType ?? "manual", 40)
  if (!name) return c.json({ error: "name is required", code: "invalid_name" }, 400)

  const [source] = await db.insert(ragSources).values({
    userId: user.id,
    name,
    sourceType,
    status: "ready",
  }).returning()

  return c.json(source)
})

ragRouter.get("/sources", async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user)) return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)

  const sources = await db.execute(sql<RagSourceInfo>`
    select
      s.id as "id",
      s.name as "name",
      s.source_type as "sourceType",
      s.status as "status",
      count(distinct d.id)::int as "documentCount",
      count(c.id)::int as "chunkCount",
      s.created_at as "createdAt",
      s.updated_at as "updatedAt"
    from rag_sources s
    left join rag_documents d on d.source_id = s.id
    left join rag_chunks c on c.document_id = d.id
    where s.user_id = ${user.id}
      and s.status <> 'deleted'
    group by s.id
    order by s.updated_at desc
  `)

  const rows = Array.isArray(sources) ? sources : ((sources as { rows?: unknown[] }).rows ?? [])
  return c.json({ sources: rows })
})

ragRouter.post("/documents", async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user)) return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)

  const body = await c.req.json().catch(() => ({})) as CreateDocumentBody
  const sourceId = body.sourceId
  const title = clean(body.title ?? "Untitled", 200)
  const content = clean(body.content ?? "", MAX_DOCUMENT_CHARS)
  if (!sourceId) return c.json({ error: "sourceId is required", code: "invalid_source" }, 400)
  if (!content) return c.json({ error: "content is required", code: "invalid_content" }, 400)

  const [source] = await db
    .select({ id: ragSources.id })
    .from(ragSources)
    .where(and(eq(ragSources.id, sourceId), eq(ragSources.userId, user.id), eq(ragSources.status, "ready")))
    .limit(1)
  if (!source) return c.json({ error: "Source not found", code: "source_not_found" }, 404)

  const [document] = await db.insert(ragDocuments).values({
    userId: user.id,
    sourceId,
    title,
    mimeType: body.mimeType ?? "text/plain",
    contentHash: hash(content),
    metadata: body.metadata ?? null,
  }).onConflictDoUpdate({
    target: [ragDocuments.userId, ragDocuments.contentHash],
    set: { title, updatedAt: new Date(), metadata: body.metadata ?? null },
  }).returning()

  if (!document) return c.json({ error: "Document insert failed" }, 500)

  await db.delete(ragChunks).where(eq(ragChunks.documentId, document.id))

  const chunks = chunkText(content)
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const [createdChunk] = await db.insert(ragChunks).values({
      userId: user.id,
      documentId: document.id,
      chunkIndex,
      content: chunk,
      tokenCount: Math.ceil(chunk.length / 4),
    }).returning({ id: ragChunks.id })
    if (!createdChunk) continue
    const embedding = await embedText(chunk)
    await db.insert(ragEmbeddings).values({
      userId: user.id,
      chunkId: createdChunk.id,
      model: EMBEDDING_MODEL,
      embedding,
    })
  }

  return c.json({ document, chunks: chunks.length })
})

ragRouter.post("/search", async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user)) return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)

  const body = await c.req.json().catch(() => ({})) as SearchBody
  const query = clean(body.query ?? "", 1000)
  if (!query) return c.json({ error: "query is required", code: "invalid_query" }, 400)
  const limit = Math.max(1, Math.min(body.limit ?? 5, 10))
  const maxChars = Math.max(500, Math.min(body.maxChars ?? 3000, 8000))
  const embedding = vectorLiteral(await embedText(query))

  const result = await db.execute(sql<CloudRagSnippet>`
    select
      c.id as "chunkId",
      d.id as "documentId",
      s.id as "sourceId",
      d.title as "title",
      c.content as "content",
      (1 - (e.embedding <=> ${embedding}::vector)) as "score"
    from rag_embeddings e
    join rag_chunks c on c.id = e.chunk_id
    join rag_documents d on d.id = c.document_id
    join rag_sources s on s.id = d.source_id
    where e.user_id = ${user.id}
      and s.status = 'ready'
    order by e.embedding <=> ${embedding}::vector
    limit ${limit}
  `)
  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])

  let used = 0
  const snippets: CloudRagSnippet[] = []
  for (const row of rows as unknown as CloudRagSnippet[]) {
    if (used + row.content.length > maxChars) break
    snippets.push(row)
    used += row.content.length
  }

  await db.insert(ragRetrievalLogs).values({
    userId: user.id,
    queryHash: hash(query),
    matchedChunkIds: snippets.map((s) => s.chunkId),
  }).catch(() => {})

  return c.json({ snippets })
})

ragRouter.delete("/sources/:id", async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user)) return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)

  const id = c.req.param("id")
  const [source] = await db.update(ragSources)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(and(eq(ragSources.id, id), eq(ragSources.userId, user.id)))
    .returning({ id: ragSources.id })

  if (!source) return c.json({ error: "Source not found", code: "source_not_found" }, 404)
  return c.json({ ok: true })
})
