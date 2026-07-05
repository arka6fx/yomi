import { Hono } from "hono"
import { authenticate } from "../auth.js"
import {
  approvePendingAction,
  createPendingAction,
  denyPendingAction,
  listPendingActions,
  type PendingActionRisk,
} from "../services/pending-actions.js"

export const actionsRouter = new Hono()

function isRisk(value: unknown): value is PendingActionRisk {
  return value === "write" || value === "send" || value === "paid" || value === "irreversible"
}

actionsRouter.get("/pending", authenticate, async (c) => {
  const user = c.get("user")
  const status = c.req.query("status") ?? "pending"
  const actions = await listPendingActions(user.id, status)
  return c.json({ actions })
})

actionsRouter.post("/pending", authenticate, async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return c.json({ error: "Invalid JSON", code: "invalid_json" }, 400)
  if (typeof body["connector"] !== "string") return c.json({ error: "connector is required" }, 400)
  if (typeof body["action"] !== "string") return c.json({ error: "action is required" }, 400)
  if (!isRisk(body["risk"])) return c.json({ error: "risk is invalid" }, 400)
  if (typeof body["title"] !== "string") return c.json({ error: "title is required" }, 400)
  if (typeof body["preview"] !== "string") return c.json({ error: "preview is required" }, 400)

  const action = await createPendingAction({
    userId: user.id,
    connector: body["connector"],
    action: body["action"],
    risk: body["risk"],
    title: body["title"],
    preview: body["preview"],
    confirmText: typeof body["confirmText"] === "string" ? body["confirmText"] : undefined,
    payload: body["payload"],
    sourcePlatform: typeof body["sourcePlatform"] === "string" ? body["sourcePlatform"] : undefined,
    sourceChatId: typeof body["sourceChatId"] === "string" ? body["sourceChatId"] : undefined,
  })
  return c.json(action, 201)
})

actionsRouter.post("/:id/approve", authenticate, async (c) => {
  const user = c.get("user")
  const id = c.req.param("id")
  if (!id) return c.json({ error: "id is required", code: "invalid_id" }, 400)
  try {
    const result = await approvePendingAction(user.id, id)
    if (!result) return c.json({ error: "Pending action not found", code: "not_found" }, 404)
    return c.json(result)
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err), code: "execution_failed" },
      500,
    )
  }
})

actionsRouter.post("/:id/deny", authenticate, async (c) => {
  const user = c.get("user")
  const id = c.req.param("id")
  if (!id) return c.json({ error: "id is required", code: "invalid_id" }, 400)
  const result = await denyPendingAction(user.id, id)
  if (!result) return c.json({ error: "Pending action not found", code: "not_found" }, 404)
  return c.json(result)
})
