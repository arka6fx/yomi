import { sql, type SQL } from "drizzle-orm"
import { db } from "@yomi/db"

import { embedMemoryText, memoryVectorLiteral } from "./embeddings.js"

export type MemorySearchKnobs = {
  candidates: number
  rrfK: number
}

// Resolved per call, not at import time, so a deploy-time env change reaches every recall path.
export function memorySearchKnobs(): MemorySearchKnobs {
  return {
    candidates: Math.max(5, Number.parseInt(process.env["MEMORY_CANDIDATES"] ?? "30", 10) || 30),
    rrfK: Math.max(1, Number.parseInt(process.env["MEMORY_RRF_K"] ?? "60", 10) || 60),
  }
}

// A closed union rather than free strings: these become bare identifiers in the ILIKE scan.
export type MemoryMetaColumn = "topic" | "summary" | "content" | "kind" | "scope" | "source_path"

export const AGENT_META_COLUMNS = ["topic", "content", "kind", "scope"] as const
export const FULL_META_COLUMNS = [
  "topic",
  "summary",
  "content",
  "kind",
  "scope",
  "source_path",
] as const

export type RecallCteInput = {
  userId: string
  query: string
  queryEmbedding: number[]
  knobs: MemorySearchKnobs
  fusedLimit: number
  metaColumns: readonly MemoryMetaColumn[]
}

// The `with ... fused` prefix shared by all three recall paths; each caller appends its own
// projection and final limit. Extracted because three byte-identical copies are how the agent
// path silently kept its own tuning constants.
export function buildRecallCte({
  userId,
  query,
  queryEmbedding,
  knobs,
  fusedLimit,
  metaColumns,
}: RecallCteInput): SQL {
  const vecSql = queryEmbedding.length
    ? sql`
        vec as (
          select me.memory_id, row_number() over (order by me.embedding <=> ${memoryVectorLiteral(queryEmbedding)}::vector) as rnk
          from memory_embeddings me
          where me.user_id = ${userId}
          order by me.embedding <=> ${memoryVectorLiteral(queryEmbedding)}::vector
          limit ${knobs.candidates}
        ),`
    : sql`
        vec as (
          select null::uuid as memory_id, null::bigint as rnk
          where false
        ),`

  const metaMatch = sql.join(
    metaColumns.map((column) => sql`${sql.raw(`e.${column}`)} ilike ${`%${query}%`}`),
    sql` or `,
  )

  return sql`
      with ${vecSql}
      fts as (
        select e.id as memory_id,
               row_number() over (order by ts_rank_cd(e.content_tsv, websearch_to_tsquery('english', ${query})) desc) as rnk
        from memory_entries e
        where e.user_id = ${userId}
          and e.status = 'active'
          and e.is_latest = true
          and e.content_tsv @@ websearch_to_tsquery('english', ${query})
        limit ${knobs.candidates}
      ),
      meta as (
        select e.id as memory_id,
               row_number() over (order by e.is_static desc, e.confidence desc, e.updated_at desc) as rnk
        from memory_entries e
        where e.user_id = ${userId}
          and e.status = 'active'
          and e.is_latest = true
          and (${metaMatch})
        limit ${knobs.candidates}
      ),
      fused as (
        select memory_id,
               sum(1.0 / (${knobs.rrfK} + rnk)) as score,
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
        limit ${fusedLimit}
      )`
}

export type MemorySearchRow = {
  kind: string
  topic: string
  content: string
  sourcePath: string | null
  isStatic: boolean
  updatedAt: string | Date
  score: number
  matchedBy: string[]
}

// Same hybrid vector+FTS+metadata query fetchMemoryContext (apps/backend/src/agent/run.ts)
// uses for passive injection, factored out so it can also back the actively-callable
// memory_search tool.
export async function searchMemoryEntries(
  userId: string,
  query: string,
  limit: number,
): Promise<MemorySearchRow[]> {
  try {
    const safe = query.trim().slice(0, 400)
    if (!safe) return []

    const queryEmbedding = await embedMemoryText(safe).catch(() => [])
    const recallCte = buildRecallCte({
      userId,
      query: safe,
      queryEmbedding,
      knobs: memorySearchKnobs(),
      fusedLimit: limit,
      metaColumns: AGENT_META_COLUMNS,
    })

    const result = await db.execute(sql`
      ${recallCte}
      select
        e.kind as "kind",
        e.topic as "topic",
        e.content as "content",
        e.source_path as "sourcePath",
        e.is_static as "isStatic",
        e.updated_at as "updatedAt",
        f.score as "score",
        f.matched_by as "matchedBy"
      from fused f
      join memory_entries e on e.id = f.memory_id
      order by e.is_static desc, f.score desc, e.confidence desc, e.updated_at desc
      limit ${limit}
    `)
    const rows = ((result as unknown as { rows?: MemorySearchRow[] }).rows ??
      []) as MemorySearchRow[]
    return rows
  } catch {
    return []
  }
}
