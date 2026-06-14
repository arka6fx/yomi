import { eq, and } from "drizzle-orm"
import { db, mcpConnections } from "@yomi/db"
import {
  decryptTokens,
  encryptTokens,
  refreshGoogleAccessToken,
} from "./token-encryption.js"

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
    if (provider === "google" || provider.startsWith("google-")) {
      tokens = await refreshGoogleAccessToken(tokens.refreshToken)
      refreshed = true
    }
    // Other OAuth providers (Slack, Notion, etc.) handle long-lived tokens or
    // surface 401s as reconnect hints — no generic refresh yet.
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
