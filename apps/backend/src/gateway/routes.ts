import { Hono, type Context } from "hono"
import { eq, and } from "drizzle-orm"
import { db, platformConnections } from "@yomi/db"
import { getDefaultGateway } from "./gateway-runner.js"
import { authenticate } from "../auth.js"
import { TelegramAdapter, type TelegramUpdate } from "./platforms/telegram.js"
import type { PlatformType } from "@yomi/shared"

export const gatewayRouter = new Hono()

// Run async work after the response is sent. On Cloudflare Workers this uses
// executionCtx.waitUntil so the isolate stays alive; in local dev (bun server)
// there is no execution context, so we just let the promise run detached.
function runInBackground(c: Context, promise: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(promise)
  } catch {
    void promise
  }
}

// Gateway status for monitoring
gatewayRouter.get("/status", (c) => {
  const gateway = getDefaultGateway()
  return c.json(gateway.getStatus())
})

// Sidecar polls this to pull pending messages
gatewayRouter.get("/pending", authenticate, async (c) => {
  const user = c.get("user")
  const messages = await getDefaultGateway().getPendingMessages(user.id)
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
gatewayRouter.post("/send", authenticate, async (c) => {
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

// Telegram webhook — Telegram calls this when users send messages to the bot.
// The URL path includes the bot token so only Telegram can hit the right endpoint.
// Additionally, Telegram sends X-Telegram-Bot-Api-Secret-Token matching the bot
// token (set via setWebhook secret_token) as a second authentication layer.
gatewayRouter.post("/telegram/webhook/:token", async (c) => {
  const token = c.req.param("token")
  const expectedToken = process.env["TELEGRAM_BOT_TOKEN"]
  if (!expectedToken || token !== expectedToken) return c.text("Not found", 404)

  const expectedSecret = expectedToken.replace(/[^A-Za-z0-9_-]/g, "")
  const secretHeader = c.req.header("X-Telegram-Bot-Api-Secret-Token")
  if (secretHeader !== expectedSecret) return c.text("Forbidden", 403)

  const update = await c.req.json<TelegramUpdate>().catch(() => null)
  if (!update) return c.text("Bad Request", 400)

  console.warn(`[gateway/telegram] webhook update=${update.update_id} hasMessage=${update.message ? "yes" : "no"}`)

  const gateway = getDefaultGateway()
  const adapter = gateway.getAdapter("telegram")
  if (!(adapter instanceof TelegramAdapter)) {
    console.warn("[gateway/telegram] adapter missing, attempting lazy gateway start")
    await gateway.start()
  }

  const readyAdapter = gateway.getAdapter("telegram")
  if (!(readyAdapter instanceof TelegramAdapter)) return c.text("No Telegram adapter", 503)

  // Acknowledge Telegram immediately and process in the background. Telegram
  // delivers a chat's updates sequentially and waits for a 2xx before sending
  // the next one, so awaiting the full agent run here would stall delivery and
  // pile up pending updates (the bot appears to stop replying). On a stateless
  // Worker a slow run also risks hitting CPU/time limits and webhook retries.
  runInBackground(c, readyAdapter.processUpdate(update).catch((err) => {
    console.warn("[gateway/telegram] background processUpdate error:", err)
  }))
  return c.json({ ok: true })
})
