import { and, eq, ne } from "drizzle-orm"
import { db, ragSources } from "@yomi/db"

export interface EnsureSourceOptions {
  path: string
  name: string
  sourceType: string
}

// Idempotent get-or-create, path-keyed and race-safe via the (userId, path) unique
// constraint. Resurrects a soft-deleted row rather than leaving it permanently dead
// and re-insert-blocked — DELETE /rag/sources/:id doesn't free the path.
export async function ensureSource(userId: string, opts: EnsureSourceOptions): Promise<string> {
  const existing = await db
    .select({ id: ragSources.id })
    .from(ragSources)
    .where(
      and(
        eq(ragSources.userId, userId),
        eq(ragSources.path, opts.path),
        ne(ragSources.status, "deleted"),
      ),
    )
    .limit(1)
  if (existing[0]) return existing[0].id

  const [created] = await db
    .insert(ragSources)
    .values({
      userId,
      name: opts.name,
      path: opts.path,
      sourceType: opts.sourceType,
      status: "ready",
    })
    .onConflictDoNothing({ target: [ragSources.userId, ragSources.path] })
    .returning()
  if (created) return created.id

  // Lost the insert race, or the (userId, path) slot is occupied by a row this
  // user soft-deleted earlier (DELETE /rag/sources/:id doesn't free the path).
  // Re-select without the status filter to find whichever row holds the slot,
  // then resurrect it if it's the deleted one — the alternative (leaving it dead
  // and permanently failing to create a fresh source) is worse.
  const [row] = await db
    .select({ id: ragSources.id, status: ragSources.status })
    .from(ragSources)
    .where(and(eq(ragSources.userId, userId), eq(ragSources.path, opts.path)))
    .limit(1)
  if (!row) throw new Error("failed to create or find source")
  if (row.status === "deleted") {
    await db
      .update(ragSources)
      .set({ status: "ready", updatedAt: new Date() })
      .where(eq(ragSources.id, row.id))
  }
  return row.id
}
