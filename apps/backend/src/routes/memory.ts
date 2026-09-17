import { createHash } from "node:crypto"
import { Hono } from "hono"
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import { db, memoryEmbeddings, memoryEntries, memoryRelations, memorySources } from "@yomi/db"
import { authenticate } from "../auth.js"
import { requireConsent } from "../middleware/consent.js"
import { embedMemoryText, memoryEmbeddingModel } from "../services/memory/embeddings.js"
import { buildRecallCte, FULL_META_COLUMNS, memorySearchKnobs } from "../services/memory/search.js"

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
  metadata?: Record<string, unknown>
  // Turn-path only: what the extraction model judged this memory to contradict, named from the
  // candidates it was shown (ADR 0006). Never accepted from an API body — see fromApiBody.
  replacesId?: string
  modelJudged?: boolean
}

type SearchMemoryBody = { query?: string; limit?: number; maxChars?: number }
type ForgetMemoryBody = { id?: string; customId?: string; query?: string; hard?: boolean }
type SyncMemoryBody = {
  memories?: MemoryInput[]
  removedIds?: string[]
  removedCustomIds?: string[]
}
// "extends" was dropped after #90 landed without giving it a producer — see ADR 0006.
type MemoryRelation = "updates"

const MAX_MEMORY_CHARS = 8_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

async function storeMemoryEmbedding(userId: string, memoryId: string, text: string): Promise<void> {
  const embedding = await embedMemoryText(text).catch(() => [])
  if (!embedding.length) return
  await db.delete(memoryEmbeddings).where(eq(memoryEmbeddings.memoryId, memoryId))
  await db.insert(memoryEmbeddings).values({
    userId,
    memoryId,
    model: memoryEmbeddingModel(),
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

// Supersession by id is judged against candidates a model was shown. A request body carries no
// such judgment, so the API path keeps the conservative topic rule (ADR 0006).
function fromApiBody(input: MemoryInput): MemoryInput {
  const sanitized = { ...input }
  delete sanitized.replacesId
  delete sanitized.modelJudged
  return sanitized
}

function normalizeTopic(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

// Topic equality only — the conservative path for writers with no conversational context (ADR 0006)
export function relationForMemory(
  input: MemoryInput,
  candidate: { topic: string },
): MemoryRelation | null {
  const topic = normalizeTopic(input.topic || input.summary || "")
  const candidateTopic = normalizeTopic(candidate.topic)
  if (topic && candidateTopic === topic) return "updates"
  return null
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
  const contentHash = hash(
    `${input.kind ?? "fact"}\0${input.scope ?? "global"}\0${topic}\0${content}`,
  )
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
          .where(
            and(
              eq(memoryEntries.userId, userId),
              eq(memoryEntries.customId, customId),
              eq(memoryEntries.isLatest, true),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null

  // A turn-aware writer names what it replaces by id, judged against candidates the model was
  // shown (ADR 0006). An id that matches nothing costs the supersession, never the memory —
  // including a malformed one, which `memory_entries.id` being a uuid column would otherwise
  // turn into a 22P02 that takes the whole write down.
  const namedId = clean(input.replacesId, 80)
  const replacesId = UUID_PATTERN.test(namedId) ? namedId : ""
  const replaced =
    replacesId && replacesId !== existing?.id
      ? await db
          .select()
          .from(memoryEntries)
          .where(
            and(
              eq(memoryEntries.userId, userId),
              eq(memoryEntries.id, replacesId),
              eq(memoryEntries.status, "active"),
              eq(memoryEntries.isLatest, true),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null

  // A model that saw this turn already decided what it contradicts. Letting topic equality fire
  // as well would supersede the duplicates and elaborations it deliberately left alone — the
  // false positive the whole judgment exists to avoid (ADR 0006).
  const candidates = input.modelJudged
    ? []
    : await db
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
            ),
          ),
        )
        .orderBy(desc(memoryEntries.confidence), desc(memoryEntries.updatedAt))
        .limit(8)

  // Everything this save replaces: the row it versions over, the row a turn-aware writer named,
  // plus every active memory on the same topic. Every one gets an `updates` edge; the first
  // also becomes the chain parent, since parentMemoryId holds one id (ADR 0006).
  const superseded = [
    ...(existing ? [existing] : []),
    ...(replaced ? [replaced] : []),
    ...candidates.filter(
      (row) =>
        row.id !== existing?.id &&
        row.id !== replaced?.id &&
        relationForMemory(input, row) === "updates",
    ),
  ]
  const parent = superseded[0] ?? null

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

  // One transaction: a supersession must never land without the `updates` edge and the
  // parent/root chain that make it undoable (ADR 0006). The neon-http driver has no
  // interactive db.transaction, so the id is generated here (the insert needs to know
  // its own id for the relation edges) and every statement runs in one db.batch
  // transaction, sequentially: freeing the custom id first, then the insert, then
  // the supersede + edge pairs.
  const insertedId = crypto.randomUUID()
  const statements: BatchItem<"pg">[] = []
  if (existing?.customId) {
    // Free the custom id first — (user_id, custom_id) is uniquely indexed where it is not null,
    // so the insert below would collide with the row it is versioning over.
    statements.push(
      db
        .update(memoryEntries)
        .set({ customId: null })
        .where(eq(memoryEntries.id, existing.id)),
    )
  }
  const insertIndex = statements.length
  statements.push(
    db
      .insert(memoryEntries)
      .values({
        id: insertedId,
        ...values,
        version: parent ? parent.version + 1 : 1,
        rootMemoryId: parent?.rootMemoryId ?? parent?.id ?? null,
        parentMemoryId: parent?.id ?? null,
        isLatest: true,
      })
      .returning(),
  )
  for (const replaced of superseded) {
    statements.push(
      db
        .update(memoryEntries)
        .set({ status: "superseded", isLatest: false, updatedAt: new Date() })
        .where(eq(memoryEntries.id, replaced.id)),
    )
    statements.push(
      db.insert(memoryRelations).values({
        userId,
        fromMemoryId: insertedId,
        toMemoryId: replaced.id,
        relationType: "updates",
      }),
    )
  }
  const results = await db.batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]])
  const entry = (results[insertIndex] as (typeof memoryEntries.$inferSelect)[] | undefined)?.[0]
  if (!entry) throw new Error("memory insert returned no row")

  if (input.sourcePath) {
    await db
      .insert(memorySources)
      .values({
        memoryId: entry.id,
        sourcePath: clean(input.sourcePath, 500),
        relevance: 100,
      })
      .catch(() => undefined)
  }
  await storeMemoryEmbedding(
    userId,
    entry.id,
    `${entry.kind}: ${entry.topic}\n${entry.summary ?? ""}\n${entry.content}`,
  ).catch(() => undefined)
  return entry
}

memoryRouter.use("*", authenticate)

memoryRouter.post("/add", requireConsent("memory"), async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as MemoryInput
  const memory = await upsertMemory(user.id, fromApiBody(body))
  if (!memory) return c.json({ error: "content is required", code: "invalid_content" }, 400)
  return c.json({ memory })
})

memoryRouter.get("/entries", requireConsent("memory"), async (c) => {
  const user = c.get("user")
  await pruneExpired(user.id)
  const limit = clampLimit(c.req.query("limit"), 50, 200)
  const rows = await db
    .select()
    .from(memoryEntries)
    .where(
      and(
        eq(memoryEntries.userId, user.id),
        eq(memoryEntries.status, "active"),
        eq(memoryEntries.isLatest, true),
      ),
    )
    .orderBy(desc(memoryEntries.isStatic), desc(memoryEntries.updatedAt))
    .limit(limit)
  return c.json({ memories: rows })
})

// Superseded memories are gone from every other read path, so this is the only way back to one
// that was replaced by mistake — the data contract the memory viewer's undo will read.
memoryRouter.get("/superseded", requireConsent("memory"), async (c) => {
  const user = c.get("user")
  const limit = clampLimit(c.req.query("limit"), 50, 200)
  const rows = await db
    .select()
    .from(memoryEntries)
    .where(and(eq(memoryEntries.userId, user.id), eq(memoryEntries.status, "superseded")))
    .orderBy(desc(memoryEntries.updatedAt))
    .limit(limit)
  if (!rows.length) return c.json({ memories: [] })

  const edges = await db
    .select({
      fromMemoryId: memoryRelations.fromMemoryId,
      toMemoryId: memoryRelations.toMemoryId,
    })
    .from(memoryRelations)
    .where(
      and(
        eq(memoryRelations.userId, user.id),
        eq(memoryRelations.relationType, "updates"),
        inArray(
          memoryRelations.toMemoryId,
          rows.map((row) => row.id),
        ),
      ),
    )
  const replacements = edges.length
    ? await db
        .select()
        .from(memoryEntries)
        .where(
          and(
            eq(memoryEntries.userId, user.id),
            inArray(
              memoryEntries.id,
              edges.map((edge) => edge.fromMemoryId),
            ),
          ),
        )
    : []

  const byId = new Map(replacements.map((row) => [row.id, row]))
  const replacedBy = new Map(edges.map((edge) => [edge.toMemoryId, byId.get(edge.fromMemoryId)]))
  return c.json({
    memories: rows.map((row) => ({ ...row, replacedBy: replacedBy.get(row.id) ?? null })),
  })
})

memoryRouter.post("/search", requireConsent("memory"), async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as SearchMemoryBody
  const query = clean(body.query, 400)
  const limit = clampLimit(body.limit, 8, 25)
  const maxChars = clampLimit(body.maxChars, 4000, 20_000)
  await pruneExpired(user.id)

  type MemorySearchRow = typeof memoryEntries.$inferSelect & {
    score?: number
    matchedBy?: string[]
  }
  let rows: MemorySearchRow[] = []
  if (!query) {
    rows = await db
      .select()
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.userId, user.id),
          eq(memoryEntries.status, "active"),
          eq(memoryEntries.isLatest, true),
        ),
      )
      .orderBy(
        desc(memoryEntries.isStatic),
        desc(memoryEntries.confidence),
        desc(memoryEntries.updatedAt),
      )
      .limit(limit)
  } else {
    const queryEmbedding = await embedMemoryText(query).catch(() => [])
    const knobs = memorySearchKnobs()
    const recallCte = buildRecallCte({
      userId: user.id,
      query,
      queryEmbedding,
      knobs,
      fusedLimit: knobs.candidates,
      metaColumns: FULL_META_COLUMNS,
    })

    const result = await db.execute(sql`
      ${recallCte}
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
    rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as MemorySearchRow[]
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

memoryRouter.post("/profile", requireConsent("memory"), async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as SearchMemoryBody
  const query = clean(body.query, 400)
  const limit = clampLimit(body.limit, 24, 80)
  await pruneExpired(user.id)

  const baseWhere = and(
    eq(memoryEntries.userId, user.id),
    eq(memoryEntries.status, "active"),
    eq(memoryEntries.isLatest, true),
  )
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
        .orderBy(
          desc(memoryEntries.isStatic),
          desc(memoryEntries.confidence),
          desc(memoryEntries.updatedAt),
        )
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

memoryRouter.patch("/:id", requireConsent("memory"), async (c) => {
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

memoryRouter.post("/sync", requireConsent("memory"), async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as SyncMemoryBody
  const synced = []
  for (const item of body.memories ?? []) {
    const memory = await upsertMemory(user.id, fromApiBody(item))
    if (memory) synced.push(memory.id)
  }

  const removedIds = (body.removedIds ?? []).map((id) => clean(id, 80)).filter(Boolean)
  const removedCustomIds = (body.removedCustomIds ?? []).map((id) => clean(id, 200)).filter(Boolean)
  let removed = 0
  for (const id of removedIds) {
    const rows = await db
      .update(memoryEntries)
      .set({ status: "forgotten", updatedAt: new Date() })
      .where(
        and(
          eq(memoryEntries.userId, user.id),
          eq(memoryEntries.id, id),
          eq(memoryEntries.status, "active"),
        ),
      )
      .returning({ id: memoryEntries.id })
    removed += rows.length
  }
  for (const customId of removedCustomIds) {
    const rows = await db
      .update(memoryEntries)
      .set({ status: "forgotten", updatedAt: new Date() })
      .where(
        and(
          eq(memoryEntries.userId, user.id),
          eq(memoryEntries.customId, customId),
          eq(memoryEntries.status, "active"),
        ),
      )
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

memoryRouter.post("/graph-walk", requireConsent("memory"), async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as {
    rootId?: string
    maxDepth?: number
    maxNodes?: number
  }
  const rootId = clean(body.rootId, 80)
  if (!rootId) return c.json({ error: "rootId is required" }, 400)
  const maxDepth = Math.min(Math.max(body.maxDepth ?? 3, 1), 6)
  const maxNodes = Math.min(Math.max(body.maxNodes ?? 16, 1), 48)

  const visited = new Set<string>()
  const chain: unknown[] = []
  const branched: unknown[] = []

  async function walk(id: string, depth: number): Promise<void> {
    if (visited.has(id) || depth > maxDepth || visited.size >= maxNodes) return
    visited.add(id)

    const relations = await db
      .select({
        targetId: memoryRelations.toMemoryId,
        relationType: memoryRelations.relationType,
      })
      .from(memoryRelations)
      .where(and(eq(memoryRelations.userId, user.id), eq(memoryRelations.fromMemoryId, id)))
      .limit(10)

    const [entry] = await db
      .select()
      .from(memoryEntries)
      .where(and(eq(memoryEntries.id, id), eq(memoryEntries.userId, user.id)))
      .limit(1)

    if (!entry) return

    const node = {
      id: entry.id,
      kind: entry.kind,
      scope: entry.scope,
      topic: entry.topic,
      // Guaranteed `updates` edges make superseded rows reliably reachable here — say which
      // ones they are rather than passing them off as current.
      status: entry.status,
      content: entry.content,
      confidence: entry.confidence,
      isStatic: entry.isStatic,
      updatedAt: entry.updatedAt.toISOString(),
      relations: relations.map((r) => ({
        targetId: r.targetId,
        relationType: r.relationType,
      })),
    }

    if (depth === 0) {
      chain.push(node)
    } else {
      branched.push(node)
    }

    for (const rel of relations) {
      await walk(rel.targetId, depth + 1)
    }
  }

  await walk(rootId, 0)

  return c.json({ root: chain[0] ?? null, chain, branched })
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
    .where(
      and(
        eq(memoryEntries.userId, user.id),
        eq(memoryEntries.id, id),
        eq(memoryEntries.status, "active"),
      ),
    )
    .returning({ id: memoryEntries.id })
  return c.json({ forgotten: forgotten.length, ids: forgotten.map((row) => row.id) })
})
