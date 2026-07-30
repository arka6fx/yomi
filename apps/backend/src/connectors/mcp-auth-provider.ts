import { eq, and } from "drizzle-orm"
import { db, mcpConnections } from "@yomi/db"
import { decryptTokens, type OAuthTokens } from "../services/token-encryption.js"
import type { MCPAuthProvider } from "@yomi/agent-core"

// Provides auth headers for MCP server requests. Reads encrypted tokens from
// mcp_connections for the given provider. On 401, returns a reconnect error.
export function createMCPAuthProvider(provider: string): MCPAuthProvider {
  return {
    async getHeaders(userId: string): Promise<Record<string, string>> {
      const [row] = await db
        .select({ oauthTokens: mcpConnections.oauthTokens })
        .from(mcpConnections)
        .where(and(eq(mcpConnections.userId, userId), eq(mcpConnections.provider, provider)))
        .limit(1)

      if (!row) {
        throw new Error(`${provider} is not connected. Visit the dashboard to connect.`)
      }

      let tokens: OAuthTokens
      try {
        tokens = decryptTokens(row.oauthTokens)
      } catch (err) {
        console.warn(`[mcp-auth] decrypt failed for ${provider}:`, err)
        throw new Error(
          `${provider} credentials could not be decrypted. Reconnect from the dashboard.`,
        )
      }

      return {
        Authorization: `Bearer ${tokens.accessToken}`,
      }
    },

    async onUnauthorized(userId: string): Promise<Record<string, string>> {
      console.warn(
        `[mcp-auth] 401 for ${provider} user ${userId} — re-auth not supported (no refresh token)`,
      )
      throw new Error(`${provider} session expired. Visit the dashboard to reconnect.`)
    },
  }
}
