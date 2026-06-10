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
    console.warn(`[discord-oauth] OAuth success — Discord user: ${discordUser.id} (${discordUser.username})`)

    // Generate linking code first (before DM attempt, so fallback always has it)
    const linkCode = randomBytes(3).toString("hex").toUpperCase().slice(0, 6)
    console.warn(`[discord-oauth] linking code generated: ${linkCode} for user ${discordUser.id}`)

    // Create DM channel between bot and user
    // Uses bot token (not user token) — requires the bot to have proper permissions.
    // Does NOT require the user to be in any guild.
    console.warn(`[discord-oauth] creating DM channel for recipient ${discordUser.id}...`)
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
      console.warn(`[discord-oauth] DM channel creation FAILED (${dmRes.status}): ${text.slice(0, 300)}`)
      // Store code anyway — user sees it on the web link page
      try {
        await db.insert(linkingCodes).values({
          code: linkCode,
          platform: "discord" as const,
          platformUserId: discordUser.id,
          platformChatId: null,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        })
        console.warn(`[discord-oauth] stored linking code ${linkCode} without chatId (DM creation failed)`)
      } catch (err) {
        console.warn("[discord-oauth] linking code DB insert error:", err)
      }
      return c.redirect(`/link?code=${linkCode}&discord_dm_failed=true`)
    }

    const dmChannel = (await dmRes.json()) as { id: string }
    console.warn(`[discord-oauth] DM channel created: ${dmChannel.id} for user ${discordUser.id}`)

    // Register the DM channel with the adapter so it polls for future messages
    const gateway = getDefaultGateway()
    const discordAdapter = gateway.getAdapter("discord")
    if (discordAdapter) {
      discordAdapter.registerDmChannel?.(dmChannel.id)
      console.warn(`[discord-oauth] registered DM channel ${dmChannel.id} with adapter`)
    }

    // Store linking code with chatId
    try {
      await db.insert(linkingCodes).values({
        code: linkCode,
        platform: "discord" as const,
        platformUserId: discordUser.id,
        platformChatId: dmChannel.id,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      })
      console.warn(`[discord-oauth] stored linking code ${linkCode} with chatId ${dmChannel.id}`)
    } catch (err) {
      console.warn("[discord-oauth] linking code DB insert error:", err)
    }

    // Send the linkCode via DM using the Discord adapter
    if (discordAdapter) {
      const appUrl =
        process.env["YOMI_APP_URL"] ??
        process.env["NEXT_PUBLIC_APP_URL"] ??
        "https://yomi.ai"
      const msg =
        `Welcome to Yomi! Your linking code: **${linkCode}**\n\n` +
        `Visit ${appUrl}/link and enter this code to connect your account. ` +
        `The code expires in 10 minutes.`
      console.warn(`[discord-oauth] sending DM with linking code to channel ${dmChannel.id}...`)
      const result = await discordAdapter.sendMessage(dmChannel.id, msg)
      if (result.ok) {
        console.warn(`[discord-oauth] DM sent successfully — messageId=${result.messageId}`)
      } else {
        console.warn(`[discord-oauth] DM send FAILED: ${result.error}`)
        // Code is still valid — user can find it on the link page via ?code= param
        // We redirect with the code so the user always sees it
        return c.redirect(`/link?code=${linkCode}&discord_dm_failed=true`)
      }
    } else {
      console.warn("[discord-oauth] discord adapter not available — cannot send DM")
      return c.redirect(`/link?code=${linkCode}&discord_dm_failed=true`)
    }

    return c.redirect("/link?discord_sent=true")
  } catch (err) {
    console.warn("[discord-oauth] callback error:", err)
    return c.redirect("/link?error=discord_auth_failed")
  }
})
