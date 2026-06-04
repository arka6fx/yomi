import { createHash } from "node:crypto"
import { Hono } from "hono"
import { and, eq, sql } from "drizzle-orm"
import { db, ragChunks, ragDocuments, ragEmbeddings, ragRetrievalLogs, ragSources } from "@yomi/db"
import { chunkMarkdown } from "@yomi/shared"
import type {
  CloudArchiveSource,
  CloudRagSnippet,
  CloudRagSyncRequest,
  RagSourceInfo,
} from "@yomi/shared"
import { authenticate } from "../auth.js"
import { effectivePlanForUser, isOwnerUser } from "../entitlements.js"
import { llmRerank, mmrRerank, parseVector, type RerankCandidate } from "../lib/rerank.js"

const EMBEDDING_MODEL = process.env["EMBEDDING_MODEL"] ?? "text-embedding-3-small"
const EMBEDDING_DIMENSIONS = 1536
const MAX_DOCUMENT_CHARS = 120_000
const CHUNK_CHARS = 1800
const CHUNK_OVERLAP = 220
const MIRROR_SOURCE_TYPE = "mirror"

// Hybrid retrieval knobs (safe defaults so unset env never breaks search).
const RAG_CANDIDATES = Math.max(5, Number.parseInt(process.env["RAG_CANDIDATES"] ?? "30", 10) || 30)
const RAG_RRF_K = Math.max(1, Number.parseInt(process.env["RAG_RRF_K"] ?? "60", 10) || 60)
const RAG_MMR_LAMBDA = Number.isFinite(Number.parseFloat(process.env["RAG_MMR_LAMBDA"] ?? ""))
  ? Number.parseFloat(process.env["RAG_MMR_LAMBDA"]!)
  : 0.7

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

function ragAllowed(user: {
  plan?: string | null
  role?: string | null
  email?: string | null
  id?: string | null
}): boolean {
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
  return chunkMarkdown(content, { targetChars: CHUNK_CHARS, overlap: CHUNK_OVERLAP })
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
  const data = (await res.json()) as { data?: { embedding?: number[] }[] }
  const embedding = data.data?.[0]?.embedding
  if (!embedding?.length) throw new Error("Embedding response was empty")
  return embedding
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((v) => (Number.isFinite(v) ? v.toFixed(8) : "0")).join(",")}]`
}

function sourceHash(source: CloudArchiveSource): string {
  return hash(`${source.path}\0${source.content}`)
}

async function findSource(userId: string, name: string, sourceType = MIRROR_SOURCE_TYPE) {
  const rows = await db
    .select()
    .from(ragSources)
    .where(
      and(
        eq(ragSources.userId, userId),
        eq(ragSources.path, name),
        eq(ragSources.sourceType, sourceType),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

async function upsertMirrorSource(userId: string, source: CloudArchiveSource) {
  const name = clean(source.path, 500)
  const title = clean(source.title || source.path.split("/").pop() || source.path, 200)
  const content = clean(source.content, MAX_DOCUMENT_CHARS)
  const contentHash = sourceHash(source)
  const existingSource = await findSource(userId, name)

  const [mirroredSource] = existingSource
    ? await db
        .update(ragSources)
        .set({
          name: title,
          path: name,
          contentHash,
          sourceType: MIRROR_SOURCE_TYPE,
          status: "ready",
          updatedAt: new Date(),
        })
        .where(eq(ragSources.id, existingSource.id))
        .returning()
    : await db
        .insert(ragSources)
        .values({
          userId,
          name: title,
          path: name,
          contentHash,
          sourceType: MIRROR_SOURCE_TYPE,
          privacyScope: "cloud_rag",
          status: "ready",
        })
        .returning()

  if (!mirroredSource) return false

  const latestDoc = await db
    .select({ contentHash: ragDocuments.contentHash })
    .from(ragDocuments)
    .where(eq(ragDocuments.sourceId, mirroredSource.id))
    .limit(1)
  if (latestDoc[0]?.contentHash === contentHash) {
    await db
      .update(ragSources)
      .set({ updatedAt: new Date() })
      .where(eq(ragSources.id, mirroredSource.id))
    return true
  }

  await db.delete(ragDocuments).where(eq(ragDocuments.sourceId, mirroredSource.id))

  const [document] = await db
    .insert(ragDocuments)
    .values({
      userId,
      sourceId: mirroredSource.id,
      title,
      mimeType: "text/markdown",
      contentHash,
      metadata: { path: source.path, updatedAt: source.updatedAt, origin: "cloud_archive" },
    })
    .returning()

  if (!document) return false

  const chunks = chunkText(content)
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const [createdChunk] = await db
      .insert(ragChunks)
      .values({
        userId,
        documentId: document.id,
        chunkIndex,
        content: chunk,
        tokenCount: Math.ceil(chunk.length / 4),
        metadata: { path: source.path, updatedAt: source.updatedAt },
      })
      .returning({ id: ragChunks.id })
    if (!createdChunk) continue
    const embedding = await embedText(chunk)
    await db.insert(ragEmbeddings).values({
      userId,
      chunkId: createdChunk.id,
      model: EMBEDDING_MODEL,
      embedding,
    })
  }

  return true
}

async function deleteMirrorSource(userId: string, name: string): Promise<boolean> {
  const source = await findSource(userId, name)
  if (!source) return false
  await db.delete(ragDocuments).where(eq(ragDocuments.sourceId, source.id))
  await db
    .update(ragSources)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(eq(ragSources.id, source.id))
  return true
}

ragRouter.use("*", authenticate)

ragRouter.post("/sources", async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user))
    return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)

  const body = (await c.req.json().catch(() => ({}))) as CreateSourceBody
  const name = clean(body.name ?? "", 120)
  const sourceType = clean(body.sourceType ?? "manual", 40)
  if (!name) return c.json({ error: "name is required", code: "invalid_name" }, 400)

  const [source] = await db
    .insert(ragSources)
    .values({
      userId: user.id,
      name,
      sourceType,
      status: "ready",
    })
    .returning()

  return c.json(source)
})

ragRouter.get("/sources", async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user))
    return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)

  const sources = await db.execute(sql<RagSourceInfo>`
    select
      s.id as "id",
      s.name as "name",
      s.path as "path",
      s.content_hash as "contentHash",
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

ragRouter.post("/sync", async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user))
    return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)

  const body = (await c.req.json().catch(() => ({}))) as CloudRagSyncRequest
  const sources = Array.isArray(body.sources) ? body.sources : []
  const removedPaths = Array.isArray(body.removedPaths) ? body.removedPaths : []

  let synced = 0
  for (const source of sources) {
    if (!clean(source.path, 500) || !clean(source.content, MAX_DOCUMENT_CHARS)) continue
    const ok = await upsertMirrorSource(user.id, source)
    if (ok) synced++
  }

  let removed = 0
  for (const path of removedPaths) {
    const ok = await deleteMirrorSource(user.id, clean(path, 500))
    if (ok) removed++
  }

  return c.json({ synced, removed })
})

ragRouter.post("/documents", async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user))
    return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)

  const body = (await c.req.json().catch(() => ({}))) as CreateDocumentBody
  const sourceId = body.sourceId
  const title = clean(body.title ?? "Untitled", 200)
  const content = clean(body.content ?? "", MAX_DOCUMENT_CHARS)
  if (!sourceId) return c.json({ error: "sourceId is required", code: "invalid_source" }, 400)
  if (!content) return c.json({ error: "content is required", code: "invalid_content" }, 400)

  const [source] = await db
    .select({ id: ragSources.id })
    .from(ragSources)
    .where(
      and(
        eq(ragSources.id, sourceId),
        eq(ragSources.userId, user.id),
        eq(ragSources.status, "ready"),
      ),
    )
    .limit(1)
  if (!source) return c.json({ error: "Source not found", code: "source_not_found" }, 404)

  const [document] = await db
    .insert(ragDocuments)
    .values({
      userId: user.id,
      sourceId,
      title,
      mimeType: body.mimeType ?? "text/plain",
      contentHash: hash(content),
      metadata: body.metadata ?? null,
    })
    .onConflictDoUpdate({
      target: [ragDocuments.sourceId, ragDocuments.contentHash],
      set: { title, updatedAt: new Date(), metadata: body.metadata ?? null },
    })
    .returning()

  if (!document) return c.json({ error: "Document insert failed" }, 500)

  await db.delete(ragChunks).where(eq(ragChunks.documentId, document.id))

  const chunks = chunkText(content)
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const [createdChunk] = await db
      .insert(ragChunks)
      .values({
        userId: user.id,
        documentId: document.id,
        chunkIndex,
        content: chunk,
        tokenCount: Math.ceil(chunk.length / 4),
      })
      .returning({ id: ragChunks.id })
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
  if (!ragAllowed(user))
    return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)

  const body = (await c.req.json().catch(() => ({}))) as SearchBody
  const query = clean(body.query ?? "", 1000)
  if (!query) return c.json({ error: "query is required", code: "invalid_query" }, 400)
  const limit = Math.max(1, Math.min(body.limit ?? 5, 10))
  const maxChars = Math.max(500, Math.min(body.maxChars ?? 3000, 8000))
  const queryVec = await embedText(query)
  const embedding = vectorLiteral(queryVec)

  // Hybrid candidate fetch: vector arm + keyword (FTS) arm fused with Reciprocal Rank Fusion.
  // Each candidate carries its embedding (::text) so the reranker can run without another query.
  type SearchRow = Omit<CloudRagSnippet, "marker"> & { embedding: string }
  const result = await db.execute(sql`
    with vec as (
      select e.chunk_id, row_number() over (order by e.embedding <=> ${embedding}::vector) as rnk
      from rag_embeddings e
      where e.user_id = ${user.id}
      order by e.embedding <=> ${embedding}::vector
      limit ${RAG_CANDIDATES}
    ),
    kw as (
      select c.id as chunk_id,
             row_number() over (order by ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', ${query})) desc) as rnk
      from rag_chunks c
      where c.user_id = ${user.id}
        and c.content_tsv @@ websearch_to_tsquery('english', ${query})
      limit ${RAG_CANDIDATES}
    ),
    fused as (
      select chunk_id, sum(1.0 / (${RAG_RRF_K} + rnk)) as score
      from (select chunk_id, rnk from vec union all select chunk_id, rnk from kw) u
      group by chunk_id
      order by score desc
      limit ${RAG_CANDIDATES}
    )
    select
      c.id as "chunkId",
      d.id as "documentId",
      s.id as "sourceId",
      s.name as "sourceName",
      d.title as "title",
      c.content as "content",
      f.score as "score",
      e.embedding::text as "embedding"
    from fused f
    join rag_chunks c on c.id = f.chunk_id
    join rag_documents d on d.id = c.document_id
    join rag_sources s on s.id = d.source_id
    join rag_embeddings e on e.chunk_id = c.id
    where s.status = 'ready'
    order by f.score desc
  `)
  const rows = (Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? [])) as unknown as SearchRow[]

  // Rerank: cheap MMR by default; optional LLM listwise rerank when enabled (falls back to MMR).
  const candidates: RerankCandidate[] = rows.map((r) => ({
    chunkId: r.chunkId,
    content: r.content,
    embedding: parseVector(r.embedding),
  }))
  const reranked =
    process.env["RAG_RERANK_LLM"] === "true"
      ? ((await llmRerank(query, candidates, limit)) ??
        mmrRerank(queryVec, candidates, limit, RAG_MMR_LAMBDA))
      : mmrRerank(queryVec, candidates, limit, RAG_MMR_LAMBDA)

  const byId = new Map(rows.map((r) => [r.chunkId, r]))
  const snippets: CloudRagSnippet[] = []
  let used = 0
  for (const cand of reranked) {
    const row = byId.get(cand.chunkId)
    if (!row) continue
    if (used + row.content.length > maxChars) break
    snippets.push({
      chunkId: row.chunkId,
      documentId: row.documentId,
      sourceId: row.sourceId,
      sourceName: row.sourceName,
      title: row.title,
      content: row.content,
      score: Number(row.score),
      marker: snippets.length + 1,
    })
    used += row.content.length
  }

  await db
    .insert(ragRetrievalLogs)
    .values({
      userId: user.id,
      queryHash: hash(query),
      matchedChunkIds: snippets.map((s) => s.chunkId),
    })
    .catch(() => {})

  return c.json({ snippets })
})

ragRouter.delete("/sources/:id", async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user))
    return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)

  const id = c.req.param("id")
  const [source] = await db
    .update(ragSources)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(and(eq(ragSources.id, id), eq(ragSources.userId, user.id)))
    .returning({ id: ragSources.id })

  if (!source) return c.json({ error: "Source not found", code: "source_not_found" }, 404)
  return c.json({ ok: true })
})
