import { eq, and } from "drizzle-orm"
import { db, mcpConnections } from "@yomi/db"
import {
  decryptTokens,
  encryptTokens,
  refreshGoogleAccessToken,
  type OAuthTokens,
} from "./token-encryption.js"
import { getConnectorDef } from "../connectors/registry.js"
import type { BackendConnectorDef } from "../connectors/types.js"

// Generic OAuth2 token refresh — supports both "basic" and "body" tokenRequestAuth.
async function refreshOAuth2Token(def: BackendConnectorDef, refreshToken: string): Promise<OAuthTokens> {
  if (def.auth.kind !== "oauth2") throw new Error(`${def.id} is not oauth2`)
  const auth = def.auth
  const clientId = process.env[auth.clientIdEnv]
  const clientSecret = process.env[auth.clientSecretEnv]
  if (!clientId || !clientSecret) throw new Error(`${auth.clientIdEnv} not configured`)

  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken })
  let authHeader: string | undefined
  if (auth.tokenRequestAuth === "basic") {
    authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
  } else {
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
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`)

  const data = (await res.json()) as {
    access_token?: string
    expires_in?: number
    refresh_token?: string
    token_type?: string
    scope?: string
  }
  if (!data.access_token) throw new Error("No access_token in refresh response")

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken, // keep old if not rotated
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    tokenType: data.token_type,
    scope: data.scope,
  }
}

// Returns a valid (auto-refreshed) access token for the given user+provider.
// Auto-refreshes when expiring within 5 minutes and persists the new token.
// Used in-process by the backend agent so it never calls itself over HTTP.
export async function getAccessToken(userId: string, provider: string): Promise<string> {
  const [row] = await db
    .select({
      oauthTokens: mcpConnections.oauthTokens,
      expiresAt: mcpConnections.expiresAt,
    })
    .from(mcpConnections)
    .where(and(eq(mcpConnections.userId, userId), eq(mcpConnections.provider, provider)))
    .limit(1)

  if (!row) throw new Error(`${provider} is not connected for this user`)

  let tokens = decryptTokens(row.oauthTokens)

  // Skip refresh for non-expiring credentials (api_key, connection_string, GitHub OAuth)
  const expiresAt = tokens.expiresAt ?? null
  const needsRefresh =
    expiresAt !== null &&
    tokens.refreshToken !== null &&
    expiresAt - Date.now() < 5 * 60 * 1000

  if (needsRefresh && tokens.refreshToken) {
    let refreshed = false
    try {
      if (provider === "google" || provider.startsWith("google-")) {
        tokens = await refreshGoogleAccessToken(tokens.refreshToken)
        refreshed = true
      } else {
        const def = getConnectorDef(provider)
        if (def?.auth.kind === "oauth2" && def.auth.tokenUrl) {
          tokens = await refreshOAuth2Token(def, tokens.refreshToken)
          refreshed = true
        }
      }
    } catch (err) {
      // Non-fatal: return existing token and let the 401 surface as a reconnect hint
      console.warn(`[integration-tokens] refresh failed for ${provider}:`, err instanceof Error ? err.message : err)
    }
    if (refreshed) {
      const encrypted = encryptTokens(tokens)
      await db
        .update(mcpConnections)
        .set({
          oauthTokens: encrypted,
          expiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
          updatedAt: new Date(),
        })
        .where(and(eq(mcpConnections.userId, userId), eq(mcpConnections.provider, provider)))
    }
  }

  return tokens.accessToken
}

// Lists providers the user has connected (for building the connector registry).
export async function listConnectedProviders(userId: string): Promise<string[]> {
  const rows = await db
    .select({ provider: mcpConnections.provider })
    .from(mcpConnections)
    .where(eq(mcpConnections.userId, userId))
  return rows.map((r) => r.provider)
}
