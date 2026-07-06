import { Hono } from "hono"
import { eq, and } from "drizzle-orm"
import { db, mcpConnections } from "@yomi/db"
import { authenticate, getAuth } from "../auth.js"
import { requireConsent } from "../middleware/consent.js"
import { encryptTokens, decryptTokens, type OAuthTokens } from "../services/token-encryption.js"
import { getAccessToken as getAccessTokenService } from "../services/integration-tokens.js"
import { getConnectorDef } from "../connectors/registry.js"
import { purgeDriveSources } from "../services/rag/drive-sync.js"
import {
  buildAuthUrl,
  handleOAuth2Callback,
  storeApiKeyCredential,
  storeConnectionString,
} from "../connectors/executors/oauth2-executor.js"

async function checkProviderHealth(
  userId: string,
  provider: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const token = await getAccessTokenService(userId, provider)
    if (provider === "notion") {
      const res = await fetch("https://api.notion.com/v1/users/me", {
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" },
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) return { ok: false, message: `Notion returned ${res.status}. Reconnect Notion.` }
    }
    if (provider.startsWith("google-")) {
      const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok)
        return {
          ok: false,
          message: `Google returned ${res.status}. Reconnect this Google integration.`,
        }
    }
    if (provider === "github") {
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "yomi-app",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        return {
          ok: false,
          message: `GitHub returned ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}. Reconnect GitHub.`,
        }
      }
    }
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Authentication failed"
    return { ok: false, message }
  }
}

async function resolveInternalUser(c: {
  req: {
    raw: Request
    header: (name: string) => string | undefined
    query: (name: string) => string | undefined
  }
}): Promise<{ userId: string } | { error: string; status: 401 | 403 | 503 }> {
  const queryUserId = c.req.query("userId")
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (session?.user) {
    if (queryUserId && queryUserId !== session.user.id) return { error: "Forbidden", status: 403 }
    return { userId: session.user.id }
  }

  const secret = process.env.SIDECAR_SECRET
  if (!secret) return { error: "SIDECAR_SECRET not configured", status: 503 }
  if (process.env["YOMI_ALLOW_SIDECAR_TOKEN_BROKER"] !== "1") {
    return { error: "Unauthorized", status: 401 }
  }
  if (c.req.header("x-sidecar-secret") !== secret) return { error: "Unauthorized", status: 401 }
  if (!queryUserId) return { error: "userId required", status: 401 }
  return { userId: queryUserId }
}

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

// In-memory rate limiter: max 5 OAuth initiations per user per minute
const oauthInitWindow = new Map<string, { count: number; windowStart: number }>()

function checkOAuthRateLimit(userId: string): boolean {
  const now = Date.now()
  const entry = oauthInitWindow.get(userId)
  if (!entry || now - entry.windowStart > 60_000) {
    oauthInitWindow.set(userId, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= 5) return false
  entry.count++
  return true
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
// Accepts sidecar-secret + ?userId=<id> (same auth pattern as /token/:provider)
// or a normal user session for dashboard use.

integrationsRouter.get("/status", async (c) => {
  const resolved = await resolveInternalUser(c)
  if ("error" in resolved) return c.json({ error: resolved.error }, resolved.status)
  const userId = resolved.userId

  const rows = await db
    .select({
      provider: mcpConnections.provider,
      displayName: mcpConnections.displayName,
      updatedAt: mcpConnections.updatedAt,
    })
    .from(mcpConnections)
    .where(eq(mcpConnections.userId, userId))

  if (c.req.query("health") !== "1") return c.json({ connected: rows.map((r) => r.provider) })

  const integrations = await Promise.all(
    rows.map(async (row) => {
      const health = await checkProviderHealth(userId, row.provider)
      return {
        provider: row.provider,
        displayName: row.displayName ?? row.provider,
        connected: true,
        healthy: health.ok,
        status: health.ok ? "connected" : "needs_reconnect",
        message: health.message ?? null,
        updatedAt: row.updatedAt.toISOString(),
      }
    }),
  )

  return c.json({ connected: rows.map((r) => r.provider), integrations })
})

// ── Start Google OAuth flow ──────────────────────────────────────────────────

integrationsRouter.get("/connect/google", authenticate, async (c) => {
  const user = c.get("user")
  if (!checkOAuthRateLimit(user.id)) {
    return c.json({ error: "Too many connect attempts — please wait a minute" }, 429)
  }

  const state = Buffer.from(JSON.stringify({ userId: user.id, ts: Date.now() })).toString(
    "base64url",
  )

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
    return c.redirect(
      `${appUrl}/dashboard?integration_error=${encodeURIComponent(error ?? "cancelled")}`,
    )
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
  } catch {
    /* best-effort */
  }

  // Persist encrypted tokens
  let encrypted: string
  try {
    encrypted = encryptTokens(tokens)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "token encryption failed"
    console.error("[yomi/integrations] google encrypt error:", msg)
    return c.redirect(`${appUrl}/dashboard?integration_error=${encodeURIComponent(msg)}`)
  }

  const scopes = (tokens.scope ?? GOOGLE_SCOPES).split(/[\s,]+/).filter(Boolean)

  try {
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : "database error"
    console.error("[yomi/integrations] google db upsert error:", msg)
    return c.redirect(
      `${appUrl}/dashboard?integration_error=${encodeURIComponent("Failed to save connection. Try reconnecting.")}`,
    )
  }

  return c.redirect(`${appUrl}/dashboard?integration_success=google`)
})

// ── Generic connector start ──────────────────────────────────────────────────
// For OAuth2 connectors: redirects to provider consent page.
// For api_key / connection_string: returns field config for the frontend modal.

integrationsRouter.get("/connect/:id", async (c) => {
  const id = c.req.param("id") ?? ""

  // Auth: try session query param first, fall back to cookie/Bearer
  const sessionToken = c.req.query("session")
  const session = sessionToken
    ? await getAuth().api.getSession({
        headers: new Headers({ Authorization: `Bearer ${sessionToken}` }),
      })
    : await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (!session?.user) return c.json({ error: "Unauthorized" }, 401)
  const user = session.user as import("../auth.js").SessionUser

  if (!checkOAuthRateLimit(user.id)) {
    return c.json({ error: "Too many connect attempts — please wait a minute" }, 429)
  }

  const def = getConnectorDef(id)
  if (!def) return c.json({ error: `Unknown connector: ${id}` }, 404)

  if (def.auth.kind === "oauth2") {
    try {
      const url = buildAuthUrl(def, user.id)
      const accept = c.req.header("Accept") ?? ""
      if (accept.includes("application/json")) {
        return c.json({ redirectUrl: url })
      }
      return c.redirect(url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "OAuth setup failed"
      console.error(`[integrations/connect/${id}]`, msg)
      return c.redirect(
        `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/dashboard?integration_error=${encodeURIComponent(msg)}`,
      )
    }
  }

  if (def.auth.kind === "api_key") {
    return c.json({
      kind: "api_key",
      fields: def.auth.fields,
      docsUrl: def.setup.docsUrl,
    })
  }

  if (def.auth.kind === "connection_string") {
    return c.json({
      kind: "connection_string",
      field: def.auth.field,
    })
  }

  return c.json({ error: "Unknown auth kind" }, 400)
})

// ── Generic OAuth2 callback ──────────────────────────────────────────────────

integrationsRouter.get("/callback/:id", async (c) => {
  const id = c.req.param("id") ?? ""
  const code = c.req.query("code")
  const stateRaw = c.req.query("state") ?? ""
  const error = c.req.query("error")

  const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"

  if (error || !code) {
    return c.redirect(
      `${appUrl}/dashboard?integration_error=${encodeURIComponent(error ?? "cancelled")}`,
    )
  }

  const def = getConnectorDef(id)
  if (!def) {
    return c.redirect(`${appUrl}/dashboard?integration_error=unknown_connector`)
  }

  try {
    const { redirectTo } = await handleOAuth2Callback(def, code, stateRaw)
    return c.redirect(redirectTo)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "callback failed"
    console.error(`[integrations/callback/${id}] unhandled error:`, err)
    return c.redirect(`${appUrl}/dashboard?integration_error=${encodeURIComponent(msg)}`)
  }
})

// ── Connect: API key (POST) ──────────────────────────────────────────────────

integrationsRouter.post(
  "/connect/api-key/:id",
  authenticate,
  requireConsent("connector_data"),
  async (c) => {
    const id = c.req.param("id") ?? ""
    const userId = c.get("user").id
    const def = getConnectorDef(id)
    if (!def) return c.json({ error: `Unknown connector: ${id}` }, 404)
    if (def.auth.kind !== "api_key") return c.json({ error: "Not an api_key connector" }, 400)

    let fields: Record<string, string>
    try {
      const body = await c.req.json()
      fields = body.fields as Record<string, string>
      if (!fields) throw new Error("fields required")
    } catch {
      return c.json({ error: "Invalid body" }, 400)
    }

    // Optional live verification
    if (def.auth.verify) {
      try {
        const ok = await def.auth.verify(fields)
        if (!ok) return c.json({ error: "API key verification failed" }, 422)
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : "Verification failed" }, 422)
      }
    }

    await storeApiKeyCredential(def, userId, fields)
    return c.json({ ok: true })
  },
)

// ── Connect: Connection string / DSN (POST) ──────────────────────────────────

integrationsRouter.post(
  "/connect/dsn/:id",
  authenticate,
  requireConsent("connector_data"),
  async (c) => {
    const id = c.req.param("id") ?? ""
    const userId = c.get("user").id
    const def = getConnectorDef(id)
    if (!def) return c.json({ error: `Unknown connector: ${id}` }, 404)
    if (def.auth.kind !== "connection_string")
      return c.json({ error: "Not a connection_string connector" }, 400)

    let dsn: string
    try {
      const body = await c.req.json()
      dsn = body.dsn as string
      if (!dsn) throw new Error("dsn required")
    } catch {
      return c.json({ error: "Invalid body — expected { dsn: string }" }, 400)
    }

    await storeConnectionString(def, userId, dsn)
    return c.json({ ok: true })
  },
)

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
    } catch {
      /* best-effort revoke */
    }
  }

  await db
    .delete(mcpConnections)
    .where(and(eq(mcpConnections.userId, user.id), eq(mcpConnections.provider, provider)))

  if (provider === "google-drive") {
    try {
      await purgeDriveSources(user.id)
    } catch (err) {
      console.error("[integrations] failed to purge drive sources:", err)
    }
  }

  return c.json({ ok: true })
})

// ── Internal token endpoint — sidecar only ───────────────────────────────────
// Returns a valid (auto-refreshed) access token for sidecar tools to use.
// Authenticated with x-sidecar-secret; never exposed to the frontend.
// Delegates to integration-tokens.ts so backend agents reuse the same logic.

integrationsRouter.get("/token/:provider", async (c) => {
  const resolved = await resolveInternalUser(c)
  if ("error" in resolved) return c.json({ error: resolved.error }, resolved.status)
  const userId = resolved.userId
  const provider = c.req.param("provider")

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
