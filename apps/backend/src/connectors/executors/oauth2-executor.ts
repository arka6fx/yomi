import { createHmac, timingSafeEqual } from "node:crypto"
import { eq, and } from "drizzle-orm"
import { db, mcpConnections } from "@yomi/db"
import { encryptTokens, type OAuthTokens } from "../../services/token-encryption.js"
import type { BackendConnectorDef } from "../types.js"

function backendUrl(): string {
  return process.env.BETTER_AUTH_BASE_URL ?? process.env.BACKEND_URL ?? "http://localhost:3001"
}

function appUrl(): string {
  return process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
}

function stateSecret(): string {
  const secret = process.env["OAUTH_STATE_SECRET"] ?? process.env["BETTER_AUTH_SECRET"]
  if (!secret) throw new Error("OAUTH_STATE_SECRET or BETTER_AUTH_SECRET not set")
  return secret
}

function signState(payload: string): string {
  return createHmac("sha256", stateSecret()).update(payload).digest("base64url")
}

// Encodes userId + timestamp with an HMAC signature for CSRF protection.
export function encodeState(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString("base64url")
  return `${payload}.${signState(payload)}`
}

export function decodeState(state: string): { userId: string; ts: number } {
  const [payload, signature] = state.split(".")
  if (!payload || !signature) throw new Error("invalid state format")
  const expected = signState(payload)
  const sig = Buffer.from(signature)
  const exp = Buffer.from(expected)
  if (sig.length !== exp.length || !timingSafeEqual(sig, exp))
    throw new Error("invalid state signature")
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  if (!decoded.userId) throw new Error("missing userId in state")
  return decoded as { userId: string; ts: number }
}

// Returns the OAuth2 consent URL for the given def, encoding userId in state.
export function buildAuthUrl(def: BackendConnectorDef, userId: string): string {
  if (def.auth.kind !== "oauth2") throw new Error(`${def.id} is not an oauth2 connector`)
  const auth = def.auth

  const clientId = process.env[auth.clientIdEnv]
  if (!clientId) throw new Error(`${auth.clientIdEnv} not set`)

  const redirectUri = `${backendUrl()}${auth.redirectPath}`
  const state = encodeState(userId)

  const url = new URL(auth.authUrl)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  if (auth.scopes.length > 0) {
    url.searchParams.set("scope", auth.scopes.join(" "))
  }
  url.searchParams.set("state", state)

  if (auth.extraAuthParams) {
    for (const [k, v] of Object.entries(auth.extraAuthParams)) {
      url.searchParams.set(k, v)
    }
  }

  return url.toString()
}

interface CallbackResult {
  redirectTo: string
}

// Exchanges the auth code for tokens, stores them encrypted, returns a redirect URL.
export async function handleOAuth2Callback(
  def: BackendConnectorDef,
  code: string,
  stateRaw: string,
): Promise<CallbackResult> {
  if (def.auth.kind !== "oauth2") {
    console.error(`[integrations/${def.id}] not an oauth2 connector`)
    return { redirectTo: `${appUrl()}/dashboard?integration_error=connector_misconfigured` }
  }
  const auth = def.auth

  const clientId = process.env[auth.clientIdEnv]
  const clientSecret = process.env[auth.clientSecretEnv]
  if (!clientId || !clientSecret) {
    const missing = !clientId ? auth.clientIdEnv : auth.clientSecretEnv
    console.error(`[integrations/${def.id}] env var not set: ${missing}`)
    return {
      redirectTo: `${appUrl()}/dashboard?integration_error=${encodeURIComponent(`${missing} not configured`)}`,
    }
  }

  // Decode and validate state (10-minute TTL)
  let userId: string
  try {
    const decoded = decodeState(stateRaw)
    userId = decoded.userId
    if (Date.now() - decoded.ts > 10 * 60 * 1000) throw new Error("state expired")
  } catch {
    return { redirectTo: `${appUrl()}/dashboard?integration_error=invalid_state` }
  }

  const redirectUri = `${backendUrl()}${auth.redirectPath}`

  // Exchange code for tokens
  let tokens: OAuthTokens
  try {
    const body = new URLSearchParams({
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    })

    let authHeader: string | undefined
    if (auth.tokenRequestAuth === "basic") {
      // Notion-style: credentials in HTTP Basic header
      authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
    } else {
      // Standard: credentials in request body
      body.set("client_id", clientId)
      body.set("client_secret", clientSecret)
    }

    const res = await fetch(auth.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body,
    })

    if (!res.ok) {
      const msg = await res.text()
      throw new Error(`Token exchange ${res.status}: ${msg.slice(0, 200)}`)
    }

    const data = (await res.json()) as {
      access_token?: string
      token_type?: string
      expires_in?: number
      refresh_token?: string
      scope?: string
      // Slack-specific: user token is nested
      authed_user?: { access_token?: string }
    }

    // Slack returns user token under authed_user
    const accessToken = data.authed_user?.access_token ?? data.access_token
    if (!accessToken) throw new Error("No access token in response")

    tokens = {
      accessToken,
      refreshToken: data.refresh_token ?? null,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
      tokenType: data.token_type,
      scope: data.scope,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "token exchange failed"
    console.error(`[integrations/${def.id}] callback error:`, msg)
    return {
      redirectTo: `${appUrl()}/dashboard?integration_error=${encodeURIComponent(msg)}`,
    }
  }

  // Fetch display name (provider-specific, best-effort)
  let displayName = def.name
  try {
    if (def.getDisplayName) {
      displayName = await def.getDisplayName(tokens.accessToken)
    }
  } catch {
    /* best-effort */
  }

  // Persist encrypted tokens (upsert on userId + provider)
  let encrypted: string
  try {
    encrypted = encryptTokens(tokens)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "token encryption failed"
    console.error(`[integrations/${def.id}] encrypt error:`, msg)
    return {
      redirectTo: `${appUrl()}/dashboard?integration_error=${encodeURIComponent(msg)}`,
    }
  }

  const scopes = (tokens.scope ?? auth.scopes.join(" ")).split(/[\s,]+/).filter(Boolean)

  try {
    await db
      .insert(mcpConnections)
      .values({
        userId,
        provider: def.id,
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
    console.error(`[integrations/${def.id}] db upsert error (userId=${userId}):`, msg)
    return {
      redirectTo: `${appUrl()}/dashboard?integration_error=${encodeURIComponent("Failed to save connection. Try reconnecting.")}`,
    }
  }

  // Completing the provider's OAuth screen IS consent to access this data —
  // grant connector_data unless the user explicitly revoked it before.
  const { grantConsentIfUndecided } = await import("../../services/privacy/checks.js")
  await grantConsentIfUndecided(userId, ["connector_data"], "connector_oauth").catch((err) =>
    console.warn(`[integrations/${def.id}] connector consent grant failed:`, err),
  )

  return { redirectTo: `${appUrl()}/dashboard?integration_success=${def.id}` }
}

// Stores api_key credentials encrypted in mcp_connections.
// fields: { primaryField: value, ...otherFields }
export async function storeApiKeyCredential(
  def: BackendConnectorDef,
  userId: string,
  fields: Record<string, string>,
): Promise<{ wasNewConnection: boolean }> {
  if (def.auth.kind !== "api_key") throw new Error(`${def.id} is not an api_key connector`)

  const [existingRow] = await db
    .select({ id: mcpConnections.id })
    .from(mcpConnections)
    .where(and(eq(mcpConnections.userId, userId), eq(mcpConnections.provider, def.id)))
    .limit(1)
  const wasNewConnection = !existingRow

  // The primary field value is stored as accessToken for compatibility with getAccessToken()
  const primaryField = def.auth.fields[0]?.name ?? "api_key"
  const tokens: OAuthTokens = {
    accessToken: fields[primaryField] ?? "",
    refreshToken: null,
    expiresAt: null,
    scope: def.auth.fields.map((f) => f.name).join(","),
  }
  const encrypted = encryptTokens(tokens)

  await db
    .insert(mcpConnections)
    .values({
      userId,
      provider: def.id,
      oauthTokens: encrypted,
      scopes: [],
      displayName: def.name,
      lastSyncAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [mcpConnections.userId, mcpConnections.provider],
      set: {
        oauthTokens: encrypted,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      },
    })

  return { wasNewConnection }
}

// Stores a connection string (DSN) encrypted in mcp_connections.
export async function storeConnectionString(
  def: BackendConnectorDef,
  userId: string,
  dsn: string,
): Promise<void> {
  if (def.auth.kind !== "connection_string")
    throw new Error(`${def.id} is not a connection_string connector`)

  const tokens: OAuthTokens = {
    accessToken: dsn,
    refreshToken: null,
    expiresAt: null,
  }
  const encrypted = encryptTokens(tokens)

  await db
    .insert(mcpConnections)
    .values({
      userId,
      provider: def.id,
      oauthTokens: encrypted,
      scopes: ["readonly"],
      displayName: def.name,
      lastSyncAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [mcpConnections.userId, mcpConnections.provider],
      set: {
        oauthTokens: encrypted,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      },
    })
}
