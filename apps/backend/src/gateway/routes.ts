import { Hono } from "hono"
import { eq, and } from "drizzle-orm"
import { db, platformConnections } from "@yomi/db"
import { getDefaultGateway } from "./gateway-runner.js"
import { authenticate } from "../auth.js"
import type { GatewayMessage, PlatformType } from "@yomi/shared"

export const gatewayRouter = new Hono()

// List linked platforms for the authenticated user
gatewayRouter.get("/connections", authenticate, async (c) => {
  const user = c.get("user")
  const rows = await db
    .select({
      platform: platformConnections.platform,
      connectedAt: platformConnections.connectedAt,
    })
    .from(platformConnections)
    .where(eq(platformConnections.userId, user.id))

  return c.json(rows)
})

// Unlink a platform for the authenticated user
gatewayRouter.delete("/connections/:platform", authenticate, async (c) => {
  const user = c.get("user")
  const platform = c.req.param("platform") as PlatformType

  if (!["telegram", "discord", "slack", "whatsapp"].includes(platform)) {
    return c.json({ ok: false, error: "Invalid platform" }, 400)
  }

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
})

// Link a platform account to the authenticated Yomi user
gatewayRouter.post("/link", authenticate, async (c) => {
  const user = c.get("user")
  const body = await c.req.json().catch(() => ({})) as { code?: string }

  if (!body.code || typeof body.code !== "string") {
    return c.json({ ok: false, error: "Missing code" }, 400)
  }

  const gateway = getDefaultGateway()
  const entry = gateway.verifyLinkingCode(body.code.toUpperCase())
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

  // Confirm to the user on the platform
  await gateway.sendMessage(entry.platform, entry.chatId,
    "✅ Your account is now linked! You can start using Yomi.")
    .catch(() => {})

  return c.json({ ok: true, platform: entry.platform })
})

// WhatsApp webhook verification (Meta sends a GET challenge)
gatewayRouter.get("/webhooks/whatsapp", (c) => {
  const mode = c.req.query("hub.mode")
  const token = c.req.query("hub.verify_token")
  const challenge = c.req.query("hub.challenge")

  if (mode !== "subscribe" || !token || !challenge) {
    return c.text("Bad request", 400)
  }

  const expected = process.env["WHATSAPP_WEBHOOK_VERIFY_TOKEN"] ?? "yomi"
  if (token !== expected) {
    return c.text("Verification token mismatch", 403)
  }

  return c.text(challenge)
})

// WhatsApp inbound messages (signed by Meta, no auth middleware)
gatewayRouter.post("/webhooks/whatsapp", async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const adapter = getDefaultGateway().getAdapter("whatsapp")
  if (!adapter || !("handleWebhookPayload" in adapter)) {
    return c.json({ error: "WhatsApp adapter not available" }, 503)
  }

  ;(adapter as { handleWebhookPayload: (body: unknown) => void }).handleWebhookPayload(body)
  return c.json({ status: "ok" })
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
