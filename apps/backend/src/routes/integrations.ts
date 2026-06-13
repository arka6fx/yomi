import { Hono } from "hono"
import { eq, and } from "drizzle-orm"
import { db, mcpConnections } from "@yomi/db"
import { authenticate } from "../auth.js"
import {
  encryptTokens,
  decryptTokens,
  refreshGoogleAccessToken,
  type OAuthTokens,
} from "../services/token-encryption.js"
import { getAccessToken as getAccessTokenService } from "../services/integration-tokens.js"

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ")

function googleClientId(): string {
  const v = process.env.GOOGLE_INTEGRATIONS_CLIENT_ID
  if (!v) throw new Error("GOOGLE_INTEGRATIONS_CLIENT_ID not set")
  return v
}

function googleClientSecret(): string {
  const v = process.env.GOOGLE_INTEGRATIONS_CLIENT_SECRET
  if (!v) throw new Error("GOOGLE_INTEGRATIONS_CLIENT_SECRET not set")
  return v
}

function redirectUri(): string {
  return (
    process.env.GOOGLE_INTEGRATIONS_REDIRECT_URI ??
    `${process.env.BETTER_AUTH_BASE_URL ?? "http://localhost:3001"}/api/integrations/callback/google`
  )
}

export const integrationsRouter = new Hono()

// ── List connected integrations (safe — no tokens) ───────────────────────────

integrationsRouter.get("/", authenticate, async (c) => {
  const user = c.get("user")
  const rows = await db
    .select({
      id: mcpConnections.id,
      provider: mcpConnections.provider,
      scopes: mcpConnections.scopes,
      expiresAt: mcpConnections.expiresAt,
      displayName: mcpConnections.displayName,
      lastSyncAt: mcpConnections.lastSyncAt,
      createdAt: mcpConnections.createdAt,
    })
    .from(mcpConnections)
    .where(eq(mcpConnections.userId, user.id))

  return c.json({
    integrations: rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      displayName: r.displayName ?? r.provider,
      scopes: r.scopes,
      connected: true,
      lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  })
})

// ── Status check — returns just which providers are connected ────────────────

integrationsRouter.get("/status", authenticate, async (c) => {
  const user = c.get("user")
  const rows = await db
    .select({ provider: mcpConnections.provider })
    .from(mcpConnections)
    .where(eq(mcpConnections.userId, user.id))

  return c.json({ connected: rows.map((r) => r.provider) })
})

// ── Start Google OAuth flow ──────────────────────────────────────────────────

integrationsRouter.get("/connect/google", authenticate, (c) => {
  const state = Buffer.from(
    JSON.stringify({ userId: c.get("user").id, ts: Date.now() }),
  ).toString("base64url")

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.searchParams.set("client_id", googleClientId())
  url.searchParams.set("redirect_uri", redirectUri())
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", GOOGLE_SCOPES)
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent") // force refresh_token
  url.searchParams.set("state", state)

  return c.redirect(url.toString())
})

// ── Google OAuth callback ────────────────────────────────────────────────────

integrationsRouter.get("/callback/google", async (c) => {
  const code = c.req.query("code")
  const stateRaw = c.req.query("state")
  const error = c.req.query("error")

  const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"

  if (error || !code) {
    return c.redirect(`${appUrl}/dashboard?integration_error=${encodeURIComponent(error ?? "cancelled")}`)
  }

  // Decode state to get userId
  let userId: string
  try {
    const decoded = JSON.parse(Buffer.from(stateRaw ?? "", "base64url").toString("utf8"))
    userId = decoded.userId
    if (!userId) throw new Error("missing userId")
    // 10-minute validity
    if (Date.now() - decoded.ts > 10 * 60 * 1000) throw new Error("state expired")
  } catch {
    return c.redirect(`${appUrl}/dashboard?integration_error=invalid_state`)
  }

  // Exchange code for tokens
  let tokens: OAuthTokens
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: googleClientId(),
        client_secret: googleClientSecret(),
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      }),
    })
    if (!res.ok) throw new Error(`Token exchange ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
      token_type?: string
      scope?: string
    }
    tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: Date.now() + data.expires_in * 1000,
      tokenType: data.token_type,
      scope: data.scope,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "token exchange failed"
    console.error("[yomi/integrations] google callback error:", msg)
    return c.redirect(`${appUrl}/dashboard?integration_error=${encodeURIComponent(msg)}`)
  }

  // Fetch the user's Google account email for display
  let displayName = "Google Gmail"
  try {
    const info = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    })
    if (info.ok) {
      const data = (await info.json()) as { email?: string }
      if (data.email) displayName = data.email
    }
  } catch { /* best-effort */ }

  // Persist encrypted tokens
  const encrypted = encryptTokens(tokens)
  const scopes = (tokens.scope ?? GOOGLE_SCOPES).split(/[\s,]+/).filter(Boolean)

  await db
    .insert(mcpConnections)
    .values({
      userId,
      provider: "google",
      oauthTokens: encrypted,
      scopes,
      expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
      displayName,
      lastSyncAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [mcpConnections.userId, mcpConnections.provider],
      set: {
        oauthTokens: encrypted,
        scopes,
        expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
        displayName,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      },
    })

  return c.redirect(`${appUrl}/dashboard?integration_success=google`)
})

// ── Disconnect integration ───────────────────────────────────────────────────

integrationsRouter.delete("/:provider", authenticate, async (c) => {
  const user = c.get("user")
  const provider = c.req.param("provider")
  if (!provider) return c.json({ error: "Provider required" }, 400)

  const [row] = await db
    .select({ oauthTokens: mcpConnections.oauthTokens })
    .from(mcpConnections)
    .where(and(eq(mcpConnections.userId, user.id), eq(mcpConnections.provider, provider)))
    .limit(1)

  if (!row) return c.json({ error: "Integration not found" }, 404)

  // Revoke token with Google before deleting
  if (provider === "google") {
    try {
      const tok = decryptTokens(row.oauthTokens)
      await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(tok.accessToken)}`, {
        method: "POST",
      })
    } catch { /* best-effort revoke */ }
  }

  await db
    .delete(mcpConnections)
    .where(and(eq(mcpConnections.userId, user.id), eq(mcpConnections.provider, provider)))

  return c.json({ ok: true })
})

// ── Internal token endpoint — sidecar only ───────────────────────────────────
// Returns a valid (auto-refreshed) access token for sidecar tools to use.
// Authenticated with x-sidecar-secret; never exposed to the frontend.
// Delegates to integration-tokens.ts so backend agents reuse the same logic.

integrationsRouter.get("/token/:provider", async (c) => {
  const secret = process.env.SIDECAR_SECRET
  const header = c.req.header("x-sidecar-secret")
  if (secret && header !== secret) return c.json({ error: "Unauthorized" }, 401)

  const userId = c.req.query("userId")
  const provider = c.req.param("provider")
  if (!userId) return c.json({ error: "userId required" }, 400)

  try {
    const accessToken = await getAccessTokenService(userId, provider)
    return c.json({ accessToken })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "token retrieval failed"
    if (msg.includes("not connected")) return c.json({ error: "Not connected" }, 404)
    console.error("[yomi/integrations] token retrieval failed:", err)
    return c.json({ error: "Token retrieval failed" }, 502)
  }
})
