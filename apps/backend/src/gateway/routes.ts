import { randomBytes } from "node:crypto"
import { Hono } from "hono"
import { eq, and } from "drizzle-orm"
import { db, platformConnections, linkingCodes } from "@yomi/db"
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

  if (!["telegram", "discord"].includes(platform)) {
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

// ── Discord OAuth2 identify flow ─────────────────────────────────────────────

// In-memory state store for CSRF protection (10-min TTL)
const oauthStateStore = new Map<string, { createdAt: number; userId: string }>()
const OAUTH_STATE_TTL = 10 * 60 * 1000

setInterval(() => {
  const now = Date.now()
  for (const [key, val] of oauthStateStore) {
    if (now - val.createdAt > OAUTH_STATE_TTL) oauthStateStore.delete(key)
  }
}, 60_000)

// Initiate OAuth — user clicks "Add Discord" on landing/dashboard
gatewayRouter.get("/discord/auth", authenticate, (c) => {
  const user = c.get("user")
  const clientId = process.env["DISCORD_CLIENT_ID"]
  const redirectUri = process.env["DISCORD_REDIRECT_URI"]
  if (!clientId || !redirectUri) {
    return c.redirect("/link?error=discord_not_configured")
  }

  const stateData = randomBytes(16).toString("hex")
  // Encode Yomi user ID in state: random.userId
  const state = `${stateData}.${user.id}`
  oauthStateStore.set(state, { createdAt: Date.now(), userId: user.id })

  const url = new URL("https://discord.com/api/oauth2/authorize")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("scope", "identify")
  url.searchParams.set("state", state)

  console.warn(`[discord-oauth] initiating authorization — scopes: identify, client_id: ${clientId}, yomiUser: ${user.id}`)

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
  if (!clientId || !clientSecret || !redirectUri) {
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

    const tokenData = (await tokenRes.json()) as { access_token: string; scope?: string }
    console.warn(`[discord-oauth] token exchange success, scopes: ${tokenData.scope ?? "unknown"}`)

    // Get Discord user ID
    const userRes = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })

    if (!userRes.ok) {
      console.warn("[discord-oauth] failed to fetch user")
      return c.redirect("/link?error=discord_auth_failed")
    }

    const discordUser = (await userRes.json()) as { id: string; username: string }
    console.warn(`[discord-oauth] OAuth success — Discord user: ${discordUser.id} (${discordUser.username}), yomiUser: ${stored.userId}`)

    // Generate linking code — stored with both Yomi userId and Discord userId
    const linkCode = randomBytes(3).toString("hex").toUpperCase().slice(0, 6)

    try {
      await db.insert(linkingCodes).values({
        code: linkCode,
        platform: "discord" as const,
        platformUserId: discordUser.id,
        platformChatId: null,
        userId: stored.userId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      })
      console.warn(`[discord-oauth] linking code ${linkCode} stored (yomiUser=${stored.userId}, discordUser=${discordUser.id})`)
    } catch (err) {
      console.warn("[discord-oauth] linking code DB insert error:", err)
      return c.redirect("/link?error=linking_code_failed")
    }

    return c.redirect(`/link?code=${linkCode}&discord_ready=true`)
  } catch (err) {
    console.warn("[discord-oauth] callback error:", err)
    return c.redirect("/link?error=discord_auth_failed")
  }
})
