import { randomBytes } from "node:crypto"
import { Hono } from "hono"
import { eq, and } from "drizzle-orm"
import { db, platformConnections, linkingCodes } from "@yomi/db"
import { getDefaultGateway } from "./gateway-runner.js"
import { authenticate } from "../auth.js"
import type { GatewayMessage, PlatformType } from "@yomi/shared"

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

  if (!["telegram", "discord", "slack", "whatsapp"].includes(platform)) {
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

// ── Discord OAuth2 identify flow ─────────────────────────────────────────────

// In-memory state store for CSRF protection (10-min TTL)
const oauthStateStore = new Map<string, { createdAt: number }>()
const OAUTH_STATE_TTL = 10 * 60 * 1000

setInterval(() => {
  const now = Date.now()
  for (const [key, val] of oauthStateStore) {
    if (now - val.createdAt > OAUTH_STATE_TTL) oauthStateStore.delete(key)
  }
}, 60_000)

// Initiate OAuth — user clicks "Add Discord" on landing/dashboard
gatewayRouter.get("/discord/auth", (c) => {
  const clientId = process.env["DISCORD_CLIENT_ID"]
  const redirectUri = process.env["DISCORD_REDIRECT_URI"]
  if (!clientId || !redirectUri) {
    return c.redirect("/link?error=discord_not_configured")
  }

  const state = randomBytes(16).toString("hex")
  oauthStateStore.set(state, { createdAt: Date.now() })

  const url = new URL("https://discord.com/api/oauth2/authorize")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("scope", "identify")
  url.searchParams.set("state", state)

  return c.redirect(url.toString())
})

// OAuth callback — Discord redirects here after user authorizes
gatewayRouter.get("/discord/callback", async (c) => {
  const code = c.req.query("code")
  const state = c.req.query("state")
  const error = c.req.query("error")

  if (error || !code || !state) {
    console.warn("[discord-oauth] callback error:", error ?? "missing params")
    return c.redirect("/link?error=discord_auth_failed")
  }

  const stored = oauthStateStore.get(state)
  oauthStateStore.delete(state)
  if (!stored || Date.now() - stored.createdAt > OAUTH_STATE_TTL) {
    console.warn("[discord-oauth] invalid/expired state")
    return c.redirect("/link?error=discord_auth_failed")
  }

  const clientId = process.env["DISCORD_CLIENT_ID"]
  const clientSecret = process.env["DISCORD_CLIENT_SECRET"]
  const redirectUri = process.env["DISCORD_REDIRECT_URI"]
  const botToken = process.env["DISCORD_BOT_TOKEN"]
  if (!clientId || !clientSecret || !redirectUri || !botToken) {
    console.warn("[discord-oauth] missing env vars")
    return c.redirect("/link?error=discord_not_configured")
  }

  try {
    // Exchange authorization code for access token
    const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    })

    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      console.warn("[discord-oauth] token exchange failed:", text)
      return c.redirect("/link?error=discord_auth_failed")
    }

    const tokenData = (await tokenRes.json()) as { access_token: string }
    console.warn("[discord-oauth] OAuth success")

    // Get Discord user ID from /users/@me
    const userRes = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })

    if (!userRes.ok) {
      console.warn("[discord-oauth] failed to fetch user")
      return c.redirect("/link?error=discord_auth_failed")
    }

    const discordUser = (await userRes.json()) as { id: string; username: string }
    console.warn(`[discord-oauth] Discord user: ${discordUser.id} (${discordUser.username})`)

    // Create DM channel with bot (needs "Allow DMs" enabled in Dev Portal)
    const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipient_id: discordUser.id }),
    })

    if (!dmRes.ok) {
      const text = await dmRes.text()
      console.warn("[discord-oauth] DM channel creation failed:", text)
      // Fallback: show discord_user_id on the link page so the flow isn't dead
      return c.redirect(`/link?discord_user_id=${discordUser.id}`)
    }

    const dmChannel = (await dmRes.json()) as { id: string }
    console.warn(`[discord-oauth] DM channel created: ${dmChannel.id}`)

    // Generate and store linking code
    const linkCode = randomBytes(3).toString("hex").toUpperCase().slice(0, 6)
    try {
      await db.insert(linkingCodes).values({
        code: linkCode,
        platform: "discord" as const,
        platformUserId: discordUser.id,
        platformChatId: dmChannel.id,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      })
    } catch (err) {
      console.warn("[discord-oauth] linking code insert error:", err)
    }

    // Send the linkCode via DM using the Discord adapter
    const gateway = getDefaultGateway()
    const discordAdapter = gateway.getAdapter("discord")
    if (discordAdapter) {
      const appUrl =
        process.env["YOMI_APP_URL"] ??
        process.env["NEXT_PUBLIC_APP_URL"] ??
        "https://yomi.ai"
      const msg =
        `Welcome to Yomi! Your linking code: **${linkCode}**\n\n` +
        `Visit ${appUrl}/link and enter this code to connect your account. ` +
        `The code expires in 10 minutes.`
      const result = await discordAdapter.sendMessage(dmChannel.id, msg)
      console.warn(`[discord-oauth] DM send result:`, result)
    }

    return c.redirect("/link?discord_sent=true")
  } catch (err) {
    console.warn("[discord-oauth] callback error:", err)
    return c.redirect("/link?error=discord_auth_failed")
  }
})
