import { Hono } from "hono"
import { eq, and } from "drizzle-orm"
import { googleGmailDef } from "@yomi/agent-core"
import { db, mcpConnections } from "@yomi/db"
import { authenticate, getAuth } from "../auth.js"
import { checkConsent, grantConsentIfUndecided } from "../services/privacy/checks.js"
import { encryptTokens, decryptTokens, type OAuthTokens } from "../services/token-encryption.js"
import { getAccessToken as getAccessTokenService } from "../services/integration-tokens.js"
import { getConnectorDef } from "../connectors/registry.js"
import { purgeDriveSources } from "../services/rag/drive-sync.js"
import {
  buildAuthUrl,
  handleOAuth2Callback,
  storeApiKeyCredential,
  storeConnectionString,
  encodeState,
  decodeState,
} from "../connectors/executors/oauth2-executor.js"
import { buildSwiggyAuthUrl, handleSwiggyCallback } from "../connectors/oauth/swiggy.js"
import { isRowConnected } from "../services/composio-connect.js"

export async function checkProviderHealth(
  userId: string,
  provider: string,
): Promise<{ ok: boolean; message?: string }> {
  // Composio-backed connectors: Yomi's mcp_connections row stores only a connected-
  // account REFERENCE (see composio-connect.ts), never real provider tokens —
  // Composio holds the OAuth grant. Probing Google/GitHub/Notion directly with that
  // reference always 401s (no accessToken to send), which falsely told users to
  // reconnect integrations that were already healthy. isRowConnected() already
  // gates which rows reach here, so an active composio row is trusted as-is.
  if (getConnectorDef(provider)?.auth.kind === "composio") return { ok: true }
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
    query: (name: string) => string | undefined
  }
}): Promise<{ userId: string } | { error: string; status: 401 | 403 }> {
  const queryUserId = c.req.query("userId")
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (session?.user) {
    if (queryUserId && queryUserId !== session.user.id) return { error: "Forbidden", status: 403 }
    return { userId: session.user.id }
  }

  return { error: "Unauthorized", status: 401 }
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"

// Every Google connector shares one OAuth client, and Google treats a user's
// authorization to a client as a SINGLE grant — revoking any one token withdraws
// consent for the whole app. Disconnecting Gmail used to 401 Calendar, Drive,
// Classroom, Tasks and Meet along with it. Only revoke when the LAST Google
// connector is going: that is when the user really is withdrawing consent.
// google-docs, google-sheets, google-slides, and google-maps have no native
// OAuth path at all — they are always Composio-only, authenticated against
// their own Composio auth config, never the shared native Google grant. A
// naive startsWith("google") prefix match would wrongly sweep them into the
// checks below, and could suppress revocation when the user disconnects
// their actual last native Google connector while one of these stays connected.
const COMPOSIO_ONLY_GOOGLE_IDS = new Set([
  "google-docs",
  "google-sheets",
  "google-slides",
  "google-maps",
])

export function shouldRevokeGoogleGrant(
  disconnecting: string,
  connectedProviders: string[],
): boolean {
  if (!disconnecting.startsWith("google") || COMPOSIO_ONLY_GOOGLE_IDS.has(disconnecting))
    return false
  return !connectedProviders.some(
    (p) => p.startsWith("google") && p !== disconnecting && !COMPOSIO_ONLY_GOOGLE_IDS.has(p),
  )
}
// Scope source of truth is the Gmail ConnectorDef — this legacy /connect/google
// route predates the generic /connect/:id path but must request identical scopes.
const GOOGLE_SCOPES = (
  googleGmailDef.auth.kind === "oauth2" ? googleGmailDef.auth.scopes : []
).join(" ")

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
      oauthTokens: mcpConnections.oauthTokens,
      scopes: mcpConnections.scopes,
      expiresAt: mcpConnections.expiresAt,
      displayName: mcpConnections.displayName,
      lastSyncAt: mcpConnections.lastSyncAt,
      createdAt: mcpConnections.createdAt,
    })
    .from(mcpConnections)
    .where(eq(mcpConnections.userId, user.id))

  return c.json({
    integrations: rows
      .filter((r) => isRowConnected(r.oauthTokens))
      .map((r) => ({
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
// Requires a user session for dashboard use.

integrationsRouter.get("/status", async (c) => {
  const resolved = await resolveInternalUser(c)
  if ("error" in resolved) return c.json({ error: resolved.error }, resolved.status)
  const userId = resolved.userId

  const allRows = await db
    .select({
      provider: mcpConnections.provider,
      oauthTokens: mcpConnections.oauthTokens,
      displayName: mcpConnections.displayName,
      updatedAt: mcpConnections.updatedAt,
    })
    .from(mcpConnections)
    .where(eq(mcpConnections.userId, userId))

  // A Composio row stuck at "initiated" (consent screen abandoned or failed) is
  // not a real connection — exclude it so the dashboard doesn't show it as connected.
  const rows = allRows.filter((r) => isRowConnected(r.oauthTokens))

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
// This literal path is matched before the generic "/connect/:id" route below,
// so it must itself defer to Composio once Gmail is flagged via
// COMPOSIO_CONNECTORS — otherwise it silently shadows the generic route and
// every Gmail connect keeps going through the old native OAuth flow.

integrationsRouter.get("/connect/google", authenticate, async (c) => {
  const user = c.get("user")
  if (!checkOAuthRateLimit(user.id)) {
    // This route always redirects the browser (never fetched as JSON from the
    // dashboard), so a plain error response would render as raw JSON text
    // instead of the dashboard's error banner.
    return c.redirect(
      `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/dashboard?integration_error=${encodeURIComponent(
        "Too many connect attempts — please wait a minute",
      )}`,
    )
  }

  const composioDef = getConnectorDef("google")
  if (composioDef?.auth.kind === "composio") {
    try {
      const { initiateComposioConnection } = await import("../services/composio-connect.js")
      const base = process.env.BETTER_AUTH_BASE_URL ?? "http://localhost:3001"
      const state = encodeState(user.id)
      const callbackUrl = `${base}/api/integrations/composio/callback/google?state=${encodeURIComponent(state)}`
      const { redirectUrl } = await initiateComposioConnection(user.id, composioDef, {
        callbackUrl,
      })
      return c.redirect(redirectUrl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Composio connect failed"
      console.error("[integrations/connect/google] composio:", msg)
      return c.redirect(
        `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/dashboard?integration_error=${encodeURIComponent(msg)}`,
      )
    }
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

  // Completing the provider's OAuth screen IS consent to access this data —
  // grant connector_data unless the user explicitly revoked it before.
  await grantConsentIfUndecided(userId, ["connector_data"], "connector_oauth").catch((err) =>
    console.warn("[yomi/integrations] connector consent grant failed:", err),
  )

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

  const def = getConnectorDef(id)
  if (!def) return c.json({ error: `Unknown connector: ${id}` }, 404)

  if (!checkOAuthRateLimit(user.id)) {
    const msg = "Too many connect attempts — please wait a minute"
    // api_key / connection_string are always driven by a fetch() from a modal
    // and need the JSON shape; oauth2 / composio are always a full-page
    // navigation and need a redirect so the dashboard's error banner renders
    // it instead of the browser showing raw JSON text.
    if (def.auth.kind === "api_key" || def.auth.kind === "connection_string") {
      return c.json({ error: msg }, 429)
    }
    return c.redirect(
      `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/dashboard?integration_error=${encodeURIComponent(msg)}`,
    )
  }

  // Composio-backed connectors: open Composio's connection flow instead of a
  // native OAuth redirect. Composio holds the grant; we store only a reference.
  if (def.auth.kind === "composio") {
    try {
      const { initiateComposioConnection } = await import("../services/composio-connect.js")
      const base = process.env.BETTER_AUTH_BASE_URL ?? "http://localhost:3001"
      // HMAC-signed state so the callback cannot be forged to attach a connection
      // to another user's account (userId is trusted only after signature check).
      const state = encodeState(user.id)
      const callbackUrl = `${base}/api/integrations/composio/callback/${id}?state=${encodeURIComponent(state)}`
      const { redirectUrl } = await initiateComposioConnection(user.id, def, { callbackUrl })
      const accept = c.req.header("Accept") ?? ""
      if (accept.includes("application/json")) return c.json({ redirectUrl })
      return c.redirect(redirectUrl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Composio connect failed"
      console.error(`[integrations/connect/${id}] composio:`, msg)
      return c.redirect(
        `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/dashboard?integration_error=${encodeURIComponent(msg)}`,
      )
    }
  }

  // Swiggy uses PKCE + dynamic client registration — different from standard OAuth2.
  if (id === "swiggy") {
    try {
      const url = await buildSwiggyAuthUrl(user.id)
      const accept = c.req.header("Accept") ?? ""
      if (accept.includes("application/json")) return c.json({ redirectUrl: url })
      return c.redirect(url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Swiggy OAuth setup failed"
      console.error(`[integrations/connect/swiggy]`, msg)
      return c.redirect(
        `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/dashboard?integration_error=${encodeURIComponent(msg)}`,
      )
    }
  }

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

// ── Swiggy OAuth callback (PKCE + dynamic client registration) ───────────────

integrationsRouter.get("/callback/swiggy", async (c) => {
  const code = c.req.query("code")
  const stateRaw = c.req.query("state") ?? ""
  const error = c.req.query("error")

  const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"

  if (error || !code) {
    return c.redirect(
      `${appUrl}/dashboard?integration_error=${encodeURIComponent(error ?? "cancelled")}`,
    )
  }

  try {
    const { redirectTo } = await handleSwiggyCallback(code, stateRaw)
    return c.redirect(redirectTo)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Swiggy callback failed"
    console.error("[integrations/callback/swiggy] unhandled error:", err)
    return c.redirect(`${appUrl}/dashboard?integration_error=${encodeURIComponent(msg)}`)
  }
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

// ── Composio connect callback ────────────────────────────────────────────────
// Composio redirects the user here after they authorize the provider. We mark the
// connection active and store the connected-account reference (no tokens).

integrationsRouter.get("/composio/callback/:id", async (c) => {
  const id = c.req.param("id") ?? ""
  const stateRaw = c.req.query("state") ?? ""
  const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"

  let userId: string
  try {
    // Verifies the HMAC signature before trusting userId — a forged/replayed
    // state (or one issued for a different user) is rejected here.
    const decoded = decodeState(stateRaw)
    userId = decoded.userId
    if (Date.now() - decoded.ts > 30 * 60 * 1000) throw new Error("state expired")
  } catch {
    return c.redirect(`${appUrl}/dashboard?integration_error=invalid_state`)
  }

  const def = getConnectorDef(id)
  if (!def || def.auth.kind !== "composio") {
    return c.redirect(`${appUrl}/dashboard?integration_error=unknown_connector`)
  }

  const status = c.req.query("status") ?? c.req.query("connectionStatus")
  if (status && !/active|success/i.test(status)) {
    return c.redirect(`${appUrl}/dashboard?integration_error=${encodeURIComponent(status)}`)
  }

  const connectedAccountId =
    c.req.query("connectedAccountId") ?? c.req.query("connected_account_id") ?? null

  try {
    const { markComposioConnectionActive } = await import("../services/composio-connect.js")
    await markComposioConnectionActive(userId, def, connectedAccountId)
    await grantConsentIfUndecided(userId, ["connector_data"], "connector_composio").catch((err) =>
      console.warn("[yomi/integrations] connector consent grant failed:", err),
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : "callback failed"
    console.error(`[integrations/composio/callback/${id}]`, msg)
    return c.redirect(`${appUrl}/dashboard?integration_error=${encodeURIComponent(msg)}`)
  }

  return c.redirect(`${appUrl}/dashboard?integration_success=${id}`)
})

// ── Connect: API key (POST) ──────────────────────────────────────────────────

integrationsRouter.post("/connect/api-key/:id", authenticate, async (c) => {
  const id = c.req.param("id") ?? ""
  const userId = c.get("user").id
  // Submitting credentials IS consent — only an explicit prior revocation
  // blocks connecting; undecided users get connector_data granted on success.
  const consent = await checkConsent(userId, "connector_data")
  if (consent.decided && !consent.allowed) {
    return c.json({ error: "Connector data access is disabled in your privacy settings" }, 403)
  }
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
  await grantConsentIfUndecided(userId, ["connector_data"], "connector_api_key").catch((err) =>
    console.warn("[yomi/integrations] connector consent grant failed:", err),
  )
  return c.json({ ok: true })
})

// ── Connect: Connection string / DSN (POST) ──────────────────────────────────

integrationsRouter.post("/connect/dsn/:id", authenticate, async (c) => {
  const id = c.req.param("id") ?? ""
  const userId = c.get("user").id
  // Submitting credentials IS consent — only an explicit prior revocation
  // blocks connecting; undecided users get connector_data granted on success.
  const consent = await checkConsent(userId, "connector_data")
  if (consent.decided && !consent.allowed) {
    return c.json({ error: "Connector data access is disabled in your privacy settings" }, 403)
  }
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
  await grantConsentIfUndecided(userId, ["connector_data"], "connector_dsn").catch((err) =>
    console.warn("[yomi/integrations] connector consent grant failed:", err),
  )
  return c.json({ ok: true })
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

  // Every Google connector shares one OAuth client, and Google treats a user's
  // authorization to a client as a SINGLE grant — so revoking any one token withdraws
  // consent for the whole app. Disconnecting Gmail used to 401 Calendar, Drive,
  // Classroom, Tasks and Meet along with it. Only revoke when the last
  // Google connector is going, which is when the user really is withdrawing consent.
  const connected = await db
    .select({ provider: mcpConnections.provider })
    .from(mcpConnections)
    .where(eq(mcpConnections.userId, user.id))

  if (
    shouldRevokeGoogleGrant(
      provider,
      connected.map((r) => r.provider),
    )
  ) {
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

// ── Internal token endpoint ───────────────────────────────────────────────────
// Returns a valid (auto-refreshed) access token for backend agents to use.
// Requires a user session; never exposed as a public route.

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
