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

  // Refresh if expiring within 5 minutes
  const expiresAt = tokens.expiresAt ?? 0
  if (expiresAt - Date.now() < 5 * 60 * 1000 && tokens.refreshToken) {
    if (provider === "google") {
      tokens = await refreshGoogleAccessToken(tokens.refreshToken)
    } else {
      throw new Error(`Token refresh not implemented for provider: ${provider}`)
    }
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
