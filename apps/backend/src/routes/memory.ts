import { createHash } from "node:crypto"
import { Hono } from "hono"
import { and, desc, eq, ilike, or, sql } from "drizzle-orm"
import { db, memoryEmbeddings, memoryEntries, memoryRelations, memorySources } from "@yomi/db"
import { authenticate } from "../auth.js"

type MemoryInput = {
  id?: string
  customId?: string
  kind?: string
  scope?: string
  topic?: string
  summary?: string
  content?: string
  confidence?: number
  sourceType?: string
  sourcePath?: string
  isStatic?: boolean
  forgetAfter?: string | null
  replacesTopic?: string
  replaces_topic?: string
  metadata?: Record<string, unknown>
}

type SearchMemoryBody = { query?: string; limit?: number; maxChars?: number }
type ForgetMemoryBody = { id?: string; customId?: string; query?: string; hard?: boolean }
type SyncMemoryBody = { memories?: MemoryInput[]; removedIds?: string[]; removedCustomIds?: string[] }
type MemoryRelation = "updates" | "extends" | "derives"

const MAX_MEMORY_CHARS = 8_000
const EMBEDDING_DIMENSIONS = 1536
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
const MEMORY_CANDIDATES = Math.max(5, Number.parseInt(process.env["MEMORY_CANDIDATES"] ?? "30", 10) || 30)
const MEMORY_RRF_K = Math.max(1, Number.parseInt(process.env["MEMORY_RRF_K"] ?? "60", 10) || 60)

export const memoryRouter = new Hono()

function clean(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g, "[redacted image]")
    .replace(/[A-Za-z0-9+/=]{400,}/g, "[redacted base64]")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, max)
    .trim()
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

async function embedText(input: string): Promise<number[]> {
  if (!input.trim()) return []
  const apiKey = process.env["AI_CREDITS_API_KEY"]
  if (!apiKey) return []
  const baseUrl = (process.env["AI_CREDITS_BASE_URL"] ?? "https://api.aicredits.in/v1").replace(/\/+$/, "")
  const model = process.env["AI_CREDITS_EMBEDDING_MODEL"] ?? DEFAULT_EMBEDDING_MODEL
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  })
  if (!res.ok) return []
  const body = (await res.json()) as { data?: { embedding?: number[] }[] }
  const embedding = body.data?.[0]?.embedding
  return Array.isArray(embedding) && embedding.length === EMBEDDING_DIMENSIONS ? embedding : []
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((v) => (Number.isFinite(v) ? v.toFixed(8) : "0")).join(",")}]`
}

async function storeMemoryEmbedding(userId: string, memoryId: string, text: string): Promise<void> {
  const embedding = await embedText(text).catch(() => [])
  if (!embedding.length) return
  await db.delete(memoryEmbeddings).where(eq(memoryEmbeddings.memoryId, memoryId))
  await db.insert(memoryEmbeddings).values({
    userId,
    memoryId,
    model: process.env["AI_CREDITS_EMBEDDING_MODEL"] ?? DEFAULT_EMBEDDING_MODEL,
    embedding,
  })
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, max)
}

function clampConfidence(value: unknown): number {
  const n = Number.parseInt(String(value ?? "70"), 10)
  if (!Number.isFinite(n)) return 70
  return Math.max(0, Math.min(100, n))
}

function forgetAfterDate(value: unknown): Date | null {
  if (!value) return null
  const d = new Date(String(value))
  return Number.isFinite(d.getTime()) ? d : null
}

function normalizeTopic(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function relationForMemory(input: MemoryInput, candidate: typeof memoryEntries.$inferSelect): MemoryRelation | null {
  const topic = normalizeTopic(input.topic || input.summary || "")
  const replacesTopic = normalizeTopic(input.replacesTopic ?? input.replaces_topic ?? "")
  const candidateTopic = normalizeTopic(candidate.topic)
  if (replacesTopic && (candidateTopic.includes(replacesTopic) || replacesTopic.includes(candidateTopic))) return "updates"
  if (topic && candidateTopic === topic) return "updates"
  if ((input.kind ?? "fact") === candidate.kind && (input.scope ?? "global") === candidate.scope) return "extends"
  return null
}

async function linkMemoryRelation(userId: string, fromMemoryId: string, toMemoryId: string, relationType: MemoryRelation) {
  if (fromMemoryId === toMemoryId) return
  await db.insert(memoryRelations).values({ userId, fromMemoryId, toMemoryId, relationType }).catch(() => undefined)
}

async function pruneExpired(userId: string): Promise<void> {
  await db.execute(sql`
    update memory_entries
    set status = 'forgotten', updated_at = now()
    where user_id = ${userId}
      and status = 'active'
      and forget_after is not null
      and forget_after < now()
  `)
}

export async function upsertMemory(userId: string, input: MemoryInput) {
  const content = clean(input.content, MAX_MEMORY_CHARS)
  const topic = clean(input.topic || input.summary || content.split("\n")[0] || "memory", 160)
  if (!content) return null

  const customId = input.customId ? clean(input.customId, 200) : null
  const contentHash = hash(`${input.kind ?? "fact"}\0${input.scope ?? "global"}\0${topic}\0${content}`)
  const existing = input.id
    ? await db
        .select()
        .from(memoryEntries)
        .where(and(eq(memoryEntries.userId, userId), eq(memoryEntries.id, clean(input.id, 80))))
        .limit(1)
        .then((rows) => rows[0] ?? null)
    : customId
      ? await db
          .select()
          .from(memoryEntries)
          .where(and(eq(memoryEntries.userId, userId), eq(memoryEntries.customId, customId), eq(memoryEntries.isLatest, true)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null

  const candidates = await db
    .select()
    .from(memoryEntries)
    .where(
      and(
        eq(memoryEntries.userId, userId),
        eq(memoryEntries.status, "active"),
        eq(memoryEntries.isLatest, true),
        or(
          ilike(memoryEntries.topic, `%${topic}%`),
          ilike(memoryEntries.summary, `%${topic}%`),
          ilike(memoryEntries.kind, `%${input.kind ?? "fact"}%`),
        ),
      ),
    )
    .orderBy(desc(memoryEntries.confidence), desc(memoryEntries.updatedAt))
    .limit(8)

  const values = {
    userId,
    customId: customId ?? existing?.customId ?? null,
    contentHash,
    kind: clean(input.kind || "fact", 40) || "fact",
    scope: clean(input.scope || "global", 80) || "global",
    topic,
    summary: input.summary ? clean(input.summary, 500) : null,
    content,
    status: "active",
    confidence: clampConfidence(input.confidence),
    sourceType: input.sourceType ? clean(input.sourceType, 80) : null,
    sourcePath: input.sourcePath ? clean(input.sourcePath, 500) : null,
    isStatic: input.isStatic === true,
    forgetAfter: forgetAfterDate(input.forgetAfter),
    metadata: input.metadata ?? null,
    updatedAt: new Date(),
  }

  if (existing) {
    await db
      .update(memoryEntries)
      .set({ customId: null, status: "superseded", isLatest: false, updatedAt: new Date() })
      .where(eq(memoryEntries.id, existing.id))
  }

  const [entry] = await db.insert(memoryEntries).values({
    ...values,
    version: existing ? existing.version + 1 : 1,
    rootMemoryId: existing?.rootMemoryId ?? existing?.id ?? null,
    parentMemoryId: existing?.id ?? null,
    isLatest: true,
  }).returning()

  if (entry && input.sourcePath) {
    await db.insert(memorySources).values({
      memoryId: entry.id,
      sourcePath: clean(input.sourcePath, 500),
      relevance: 100,
    }).catch(() => undefined)
  }
  if (entry) {
    await storeMemoryEmbedding(userId, entry.id, `${entry.kind}: ${entry.topic}\n${entry.summary ?? ""}\n${entry.content}`).catch(
      () => undefined,
    )
    if (existing) await linkMemoryRelation(userId, entry.id, existing.id, "updates")
    for (const candidate of candidates) {
      if (candidate.id === entry.id || candidate.id === existing?.id) continue
      const relationType = relationForMemory(input, candidate)
      if (!relationType) continue
      await linkMemoryRelation(userId, entry.id, candidate.id, relationType)
      if (relationType === "updates") {
        await db
          .update(memoryEntries)
          .set({ status: "superseded", isLatest: false, updatedAt: new Date() })
          .where(eq(memoryEntries.id, candidate.id))
      }
    }
  }
  return entry ?? null
}

memoryRouter.use("*", authenticate)

memoryRouter.post("/add", async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as MemoryInput
  const memory = await upsertMemory(user.id, body)
  if (!memory) return c.json({ error: "content is required", code: "invalid_content" }, 400)
  return c.json({ memory })
})

memoryRouter.get("/entries", async (c) => {
  const user = c.get("user")
  await pruneExpired(user.id)
  const limit = clampLimit(c.req.query("limit"), 50, 200)
  const rows = await db
    .select()
    .from(memoryEntries)
    .where(and(eq(memoryEntries.userId, user.id), eq(memoryEntries.status, "active"), eq(memoryEntries.isLatest, true)))
    .orderBy(desc(memoryEntries.isStatic), desc(memoryEntries.updatedAt))
    .limit(limit)
  return c.json({ memories: rows })
})

memoryRouter.post("/search", async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as SearchMemoryBody
  const query = clean(body.query, 400)
  const limit = clampLimit(body.limit, 8, 25)
  const maxChars = clampLimit(body.maxChars, 4000, 20_000)
  await pruneExpired(user.id)

  type MemorySearchRow = typeof memoryEntries.$inferSelect & { score?: number; matchedBy?: string[] }
  let rows: MemorySearchRow[] = []
  if (!query) {
    rows = await db
      .select()
      .from(memoryEntries)
      .where(and(eq(memoryEntries.userId, user.id), eq(memoryEntries.status, "active"), eq(memoryEntries.isLatest, true)))
      .orderBy(desc(memoryEntries.isStatic), desc(memoryEntries.confidence), desc(memoryEntries.updatedAt))
      .limit(limit)
  } else {
    const queryEmbedding = await embedText(query).catch(() => [])
    const vecSql = queryEmbedding.length
      ? sql`
        vec as (
          select me.memory_id, row_number() over (order by me.embedding <=> ${vectorLiteral(queryEmbedding)}::vector) as rnk
          from memory_embeddings me
          where me.user_id = ${user.id}
          order by me.embedding <=> ${vectorLiteral(queryEmbedding)}::vector
          limit ${MEMORY_CANDIDATES}
        ),`
      : sql`
        vec as (
          select null::uuid as memory_id, null::bigint as rnk
          where false
        ),`

    const result = await db.execute(sql`
      with ${vecSql}
      fts as (
        select e.id as memory_id,
               row_number() over (order by ts_rank_cd(e.content_tsv, websearch_to_tsquery('english', ${query})) desc) as rnk
        from memory_entries e
        where e.user_id = ${user.id}
          and e.status = 'active'
          and e.is_latest = true
          and e.content_tsv @@ websearch_to_tsquery('english', ${query})
        limit ${MEMORY_CANDIDATES}
      ),
      meta as (
        select e.id as memory_id,
               row_number() over (order by e.is_static desc, e.confidence desc, e.updated_at desc) as rnk
        from memory_entries e
        where e.user_id = ${user.id}
          and e.status = 'active'
          and e.is_latest = true
          and (
            e.topic ilike ${`%${query}%`} or
            e.summary ilike ${`%${query}%`} or
            e.content ilike ${`%${query}%`} or
            e.kind ilike ${`%${query}%`} or
            e.scope ilike ${`%${query}%`} or
            e.source_path ilike ${`%${query}%`}
          )
        limit ${MEMORY_CANDIDATES}
      ),
      fused as (
        select memory_id,
               sum(1.0 / (${MEMORY_RRF_K} + rnk)) as score,
               array_agg(source) as matched_by
        from (
          select memory_id, rnk, 'vector'::text as source from vec where memory_id is not null
          union all
          select memory_id, rnk, 'full_text'::text as source from fts
          union all
          select memory_id, rnk, 'metadata'::text as source from meta
        ) u
        group by memory_id
        order by score desc
        limit ${MEMORY_CANDIDATES}
      )
      select
        e.id as "id",
        e.user_id as "userId",
        e.custom_id as "customId",
        e.content_hash as "contentHash",
        e.kind as "kind",
        e.scope as "scope",
        e.topic as "topic",
        e.summary as "summary",
        e.content as "content",
        e.status as "status",
        e.confidence as "confidence",
        e.source_type as "sourceType",
        e.source_path as "sourcePath",
        e.version as "version",
        e.is_latest as "isLatest",
        e.is_static as "isStatic",
        e.root_memory_id as "rootMemoryId",
        e.parent_memory_id as "parentMemoryId",
        e.forget_after as "forgetAfter",
        e.metadata as "metadata",
        e.created_at as "createdAt",
        e.updated_at as "updatedAt",
        f.score as "score",
        f.matched_by as "matchedBy"
      from fused f
      join memory_entries e on e.id = f.memory_id
      order by e.is_static desc, f.score desc, e.confidence desc, e.updated_at desc
      limit ${limit}
    `)
    rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as MemorySearchRow[]
  }

  const memories = []
  let used = 0
  for (const row of rows) {
    const serialized = `${row.kind}: ${row.topic}\n${row.summary ? `${row.summary}\n` : ""}${row.content}`
    if (used + serialized.length > maxChars) break
    memories.push(row)
    used += serialized.length
  }
  return c.json({ memories })
})

memoryRouter.post("/profile", async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as SearchMemoryBody
  const query = clean(body.query, 400)
  const limit = clampLimit(body.limit, 24, 80)
  await pruneExpired(user.id)

  const baseWhere = and(eq(memoryEntries.userId, user.id), eq(memoryEntries.status, "active"), eq(memoryEntries.isLatest, true))
  const staticRows = await db
    .select()
    .from(memoryEntries)
    .where(and(baseWhere, eq(memoryEntries.isStatic, true)))
    .orderBy(desc(memoryEntries.confidence), desc(memoryEntries.updatedAt))
    .limit(limit)

  const dynamicRows = await db
    .select()
    .from(memoryEntries)
    .where(and(baseWhere, eq(memoryEntries.isStatic, false)))
    .orderBy(desc(memoryEntries.confidence), desc(memoryEntries.updatedAt))
    .limit(limit)

  const relevant = query
    ? await db
        .select()
        .from(memoryEntries)
        .where(
          and(
            baseWhere,
            or(
              ilike(memoryEntries.topic, `%${query}%`),
              ilike(memoryEntries.content, `%${query}%`),
              ilike(memoryEntries.summary, `%${query}%`),
            ),
          ),
        )
        .orderBy(desc(memoryEntries.isStatic), desc(memoryEntries.confidence), desc(memoryEntries.updatedAt))
        .limit(Math.min(limit, 12))
    : []

  return c.json({
    profile: {
      static: staticRows.map((row) => row.summary || row.content),
      dynamic: dynamicRows.map((row) => row.summary || row.content),
    },
    memories: relevant,
  })
})

memoryRouter.patch("/:id", async (c) => {
  const user = c.get("user")
  const id = clean(c.req.param("id"), 80)
  const body = (await c.req.json().catch(() => ({}))) as MemoryInput
  const [existing] = await db
    .select()
    .from(memoryEntries)
    .where(and(eq(memoryEntries.userId, user.id), eq(memoryEntries.id, id)))
    .limit(1)
  if (!existing) return c.json({ error: "memory not found", code: "not_found" }, 404)

  const memory = await upsertMemory(user.id, {
    customId: existing.customId ?? undefined,
    id: existing.id,
    kind: body.kind ?? existing.kind,
    scope: body.scope ?? existing.scope,
    topic: body.topic ?? existing.topic,
    summary: body.summary ?? existing.summary ?? undefined,
    content: body.content ?? existing.content,
    confidence: body.confidence ?? existing.confidence,
    sourceType: body.sourceType ?? existing.sourceType ?? undefined,
    sourcePath: body.sourcePath ?? existing.sourcePath ?? undefined,
    isStatic: body.isStatic ?? existing.isStatic,
    forgetAfter: body.forgetAfter ?? existing.forgetAfter?.toISOString() ?? null,
    metadata: body.metadata ?? (existing.metadata as Record<string, unknown> | null) ?? undefined,
  })
  return c.json({ memory })
})

memoryRouter.post("/sync", async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as SyncMemoryBody
  const synced = []
  for (const item of body.memories ?? []) {
    const memory = await upsertMemory(user.id, item)
    if (memory) synced.push(memory.id)
  }

  const removedIds = (body.removedIds ?? []).map((id) => clean(id, 80)).filter(Boolean)
  const removedCustomIds = (body.removedCustomIds ?? []).map((id) => clean(id, 200)).filter(Boolean)
  let removed = 0
  for (const id of removedIds) {
    const rows = await db
      .update(memoryEntries)
      .set({ status: "forgotten", updatedAt: new Date() })
      .where(and(eq(memoryEntries.userId, user.id), eq(memoryEntries.id, id), eq(memoryEntries.status, "active")))
      .returning({ id: memoryEntries.id })
    removed += rows.length
  }
  for (const customId of removedCustomIds) {
    const rows = await db
      .update(memoryEntries)
      .set({ status: "forgotten", updatedAt: new Date() })
      .where(and(eq(memoryEntries.userId, user.id), eq(memoryEntries.customId, customId), eq(memoryEntries.status, "active")))
      .returning({ id: memoryEntries.id })
    removed += rows.length
  }
  return c.json({ synced: synced.length, ids: synced, removed })
})

memoryRouter.post("/forget", async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as ForgetMemoryBody
  const id = clean(body.id, 80)
  const customId = clean(body.customId, 200)
  const query = clean(body.query, 400)
  if (!id && !customId && !query)
    return c.json({ error: "id, customId, or query is required", code: "invalid_target" }, 400)

  const where = id
    ? and(eq(memoryEntries.userId, user.id), eq(memoryEntries.id, id))
    : customId
      ? and(eq(memoryEntries.userId, user.id), eq(memoryEntries.customId, customId))
      : and(
          eq(memoryEntries.userId, user.id),
          eq(memoryEntries.status, "active"),
          or(ilike(memoryEntries.topic, `%${query}%`), ilike(memoryEntries.content, `%${query}%`)),
        )

  if (body.hard === true) {
    const deleted = await db.delete(memoryEntries).where(where).returning({ id: memoryEntries.id })
    return c.json({ deleted: deleted.length, ids: deleted.map((row) => row.id) })
  }

  const forgotten = await db
    .update(memoryEntries)
    .set({ status: "forgotten", updatedAt: new Date() })
    .where(where)
    .returning({ id: memoryEntries.id })

  return c.json({ forgotten: forgotten.length, ids: forgotten.map((row) => row.id) })
})

memoryRouter.delete("/:id", async (c) => {
  const user = c.get("user")
  const id = clean(c.req.param("id"), 80)
  const hard = c.req.query("hard") === "1"
  if (hard) {
    const deleted = await db
      .delete(memoryEntries)
      .where(and(eq(memoryEntries.userId, user.id), eq(memoryEntries.id, id)))
      .returning({ id: memoryEntries.id })
    return c.json({ deleted: deleted.length, ids: deleted.map((row) => row.id) })
  }
  const forgotten = await db
    .update(memoryEntries)
    .set({ status: "forgotten", updatedAt: new Date() })
    .where(and(eq(memoryEntries.userId, user.id), eq(memoryEntries.id, id), eq(memoryEntries.status, "active")))
    .returning({ id: memoryEntries.id })
  return c.json({ forgotten: forgotten.length, ids: forgotten.map((row) => row.id) })
})
