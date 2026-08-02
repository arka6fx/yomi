import { sql, type SQL } from "drizzle-orm"

import { memoryVectorLiteral } from "./embeddings.js"

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
