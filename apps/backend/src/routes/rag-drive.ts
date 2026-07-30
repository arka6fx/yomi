import { Hono } from "hono"
import { and, eq } from "drizzle-orm"
import { db, ragSources, ragDocuments } from "@yomi/db"
import { authenticate } from "../auth.js"
import { requireConsent } from "../middleware/consent.js"
import { effectivePlanForUser, isOwnerUser } from "../entitlements.js"
import {
  createDriveSource,
  syncSource,
  DRIVE_SOURCE_TYPE,
  type SourceRow,
} from "../services/rag/drive-sync.js"

export const ragDriveRouter = new Hono()

function ragAllowed(user: { id: string; email?: string | null; plan?: string | null }): boolean {
  if (isOwnerUser(user)) return true
  const plan = effectivePlanForUser(user)
  return plan === "pro" || plan === "max"
}

ragDriveRouter.use("*", authenticate)

ragDriveRouter.post("/sources", requireConsent("cloud_memory"), async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user))
    return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)
  const body = (await c.req.json().catch(() => ({}))) as { folderId?: string; name?: string }
  const folderId = (body.folderId ?? "").trim()
  const name = (body.name ?? "Drive folder").trim().slice(0, 120)
  if (!folderId) return c.json({ error: "folderId is required", code: "invalid_folder" }, 400)
  if (!/^[A-Za-z0-9_-]+$/.test(folderId))
    return c.json({ error: "folderId is invalid", code: "invalid_folder" }, 400)
  const created = await createDriveSource(user.id, folderId, name)
  return c.json(created)
})

ragDriveRouter.get("/sources", requireConsent("cloud_memory"), async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user))
    return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)
  const rows = await db
    .select()
    .from(ragSources)
    .where(and(eq(ragSources.userId, user.id), eq(ragSources.sourceType, DRIVE_SOURCE_TYPE)))
  const sources = rows
    .filter((r) => r.status !== "deleted")
    .map((r) => ({
      id: r.id,
      name: r.name,
      folderId: r.path,
      status: r.status,
      syncState: r.syncState,
    }))
  return c.json({ sources })
})

ragDriveRouter.delete("/sources/:id", async (c) => {
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
  await db.delete(ragDocuments).where(eq(ragDocuments.sourceId, source.id))
  return c.json({ ok: true })
})

ragDriveRouter.post("/sources/:id/sync", requireConsent("cloud_memory"), async (c) => {
  const user = c.get("user")
  if (!ragAllowed(user))
    return c.json({ error: "Cloud RAG requires Pro", code: "upgrade_required" }, 403)
  const id = c.req.param("id")
  if (!id) return c.json({ error: "id is required", code: "invalid_id" }, 400)
  const [row] = await db
    .select()
    .from(ragSources)
    .where(and(eq(ragSources.id, id), eq(ragSources.userId, user.id)))
    .limit(1)
  if (!row) return c.json({ error: "not found", code: "not_found" }, 404)
  const result = await syncSource(row as unknown as SourceRow)
  return c.json(result)
})
