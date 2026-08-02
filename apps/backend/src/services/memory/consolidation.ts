import { sql } from "drizzle-orm"
import { db } from "@yomi/db"

// Deliberately much stricter than TURN_CANDIDATE_LIMIT's unbounded shortlist (contradiction.ts)
// — there is no LLM double-check here to catch an elaboration being wrongly merged, so detection
// must be conservative by default. See design:
// docs/superpowers/specs/2026-08-02-memory-consolidation-sweep-design.md
const DEFAULT_MAX_DISTANCE = 0.03

function maxDistance(): number {
  const raw = Number(process.env["MEMORY_CONSOLIDATION_MAX_DISTANCE"])
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_DISTANCE
}

export type DuplicatePair = {
  userId: string
  aId: string
  aCreatedAt: Date
  bId: string
  bCreatedAt: Date
}

// Self-joins memory_embeddings per user (memory_id > memory_id guards against matching a pair
// twice), requiring both sides active/latest and sharing a kind. Once a row's status flips to
// 'merged' it fails this join, so a merged pair can never be rematched — no tracking column
// needed (design doc, "Self-limiting, no new column").
export async function findDuplicatePairs(batchSize: number): Promise<DuplicatePair[]> {
  const distance = maxDistance()
  try {
    const result = await db.execute(sql`
      select a.user_id as "userId",
             a.id as "aId", a.created_at as "aCreatedAt",
             b.id as "bId", b.created_at as "bCreatedAt"
      from memory_embeddings ea
      join memory_embeddings eb
        on eb.user_id = ea.user_id and eb.memory_id > ea.memory_id
      join memory_entries a on a.id = ea.memory_id
        and a.status = 'active' and a.is_latest = true
      join memory_entries b on b.id = eb.memory_id
        and b.status = 'active' and b.is_latest = true
        and b.kind = a.kind
      where ea.embedding <=> eb.embedding < ${distance}
      order by (ea.embedding <=> eb.embedding) asc
      limit ${batchSize}
    `)
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as Record<string, unknown>[]
    return rows
      .filter(
        (row) =>
          typeof row["userId"] === "string" &&
          typeof row["aId"] === "string" &&
          typeof row["bId"] === "string",
      )
      .map((row) => ({
        userId: String(row["userId"]),
        aId: String(row["aId"]),
        aCreatedAt: new Date(row["aCreatedAt"] as string | number | Date),
        bId: String(row["bId"]),
        bCreatedAt: new Date(row["bCreatedAt"] as string | number | Date),
      }))
  } catch {
    return []
  }
}
