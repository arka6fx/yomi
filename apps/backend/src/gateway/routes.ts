import { Hono } from "hono"
import { eq, and } from "drizzle-orm"
import { db, platformConnections } from "@yomi/db"
import { getDefaultGateway } from "./gateway-runner.js"
import { authenticate } from "../auth.js"
import type { PlatformType } from "@yomi/shared"

export const gatewayRouter = new Hono()

// Gateway status for monitoring
gatewayRouter.get("/status", (c) => {
  const gateway = getDefaultGateway()
  return c.json(gateway.getStatus())
})

// Sidecar polls this to pull pending messages
gatewayRouter.get("/pending", authenticate, (c) => {
  const user = c.get("user")
  const messages = getDefaultGateway().getPendingMessages(user.id)
  return c.json({ messages })
})

// List linked platforms for the authenticated user
gatewayRouter.get("/connections", authenticate, async (c) => {
  const user = c.get("user")
  try {
    const rows = await db
      .select({
        platform: platformConnections.platform,
        connectedAt: platformConnections.connectedAt,
      })
      .from(platformConnections)
      .where(eq(platformConnections.userId, user.id))

    return c.json(rows)
  } catch (err) {
    console.warn("[gateway] connections error:", err)
    return c.json([], 200)
  }
})

// Unlink a platform for the authenticated user
gatewayRouter.delete("/connections/:platform", authenticate, async (c) => {
  const user = c.get("user")
  const platform = c.req.param("platform") as PlatformType

  if (!["telegram"].includes(platform)) {
    return c.json({ ok: false, error: "Invalid platform" }, 400)
  }

  try {
    const result = await db
      .delete(platformConnections)
      .where(
        and(
          eq(platformConnections.userId, user.id),
          eq(platformConnections.platform, platform),
        ),
      )
      .returning({ id: platformConnections.id })

    if (result.length === 0) {
      return c.json({ ok: false, error: "No connection found" }, 404)
    }

    return c.json({ ok: true })
  } catch (err) {
    console.warn("[gateway] unlink error:", err)
    return c.json({ ok: false, error: "Failed to unlink" }, 500)
  }
})

// Link a platform account to the authenticated Yomi user
gatewayRouter.post("/link", authenticate, async (c) => {
  const user = c.get("user")
  const body = await c.req.json().catch(() => ({})) as { code?: string }

  if (!body.code || typeof body.code !== "string") {
    return c.json({ ok: false, error: "Missing code" }, 400)
  }

  const gateway = getDefaultGateway()
  const entry = await gateway.verifyLinkingCode(body.code.toUpperCase())
  if (!entry) {
    return c.json({ ok: false, error: "Invalid or expired code" }, 400)
  }

  try {
    await db.insert(platformConnections).values({
      userId: user.id,
      platform: entry.platform,
      platformUserId: entry.platformUserId,
      platformChatId: entry.chatId,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ ok: false, error: `Failed to link account: ${msg}` }, 500)
  }

  // Confirm to the user on the platform (only if we have a chatId)
  if (entry.chatId) {
    await gateway.sendMessage(entry.platform, entry.chatId,
      "✅ Your account is now linked! You can start using Yomi.")
      .catch(() => {})
  }

  return c.json({ ok: true, platform: entry.platform, chatId: entry.chatId })
})

// Sidecar calls this to send a reply back through the platform
gatewayRouter.post("/send", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    platform?: PlatformType
    chatId?: string
    text?: string
    replyTo?: string
  }

  if (!body.platform || !body.chatId || !body.text) {
    return c.json({ ok: false, error: "Missing required fields: platform, chatId, text" }, 400)
  }

  const gateway = getDefaultGateway()
  const result = await gateway.sendMessage(body.platform, body.chatId, body.text, {
    replyTo: body.replyTo,
  })
  return c.json(result)
})

// Telegram deep-link token — returns a one-time https://t.me/<bot>?start=<token> URL
gatewayRouter.post("/telegram/token", authenticate, async (c) => {
  const user = c.get("user")
  try {
    const gateway = getDefaultGateway()
    const result = await gateway.createTelegramLinkToken(user.id)
    return c.json(result)
  } catch (err) {
    console.warn("[gateway] telegram token creation error:", err)
    return c.json({ error: "Failed to create token" }, 500)
  }
})
