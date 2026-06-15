import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError } from "./connector-def.js"

export function createDiscordTools(ctx: ConnectorContext): ToolSet {
  async function discord<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await ctx.getAccessToken(ctx.userId, "discord-connector")
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Discord API ${path} → HTTP ${res.status}: ${body.slice(0, 200)}`)
    }
    return res.json() as Promise<T>
  }

  return {
    "discord-getProfile": tool({
      description: "Get the authenticated user's Discord profile — username, discriminator, and avatar.",
      parameters: z.object({}),
      execute: async () => {
        try {
          const user = await discord<{
            id: string
            username: string
            discriminator: string
            global_name?: string | null
            avatar?: string | null
          }>("/users/@me")
          const displayName = user.global_name ?? `${user.username}#${user.discriminator}`
          return {
            id: user.id,
            username: user.username,
            displayName,
            avatarUrl: user.avatar
              ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
              : null,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "discord-listServers": tool({
      description: "List Discord servers (guilds) the user is a member of.",
      parameters: z.object({
        limit: z.number().int().min(1).max(50).default(20).describe("Max servers to return"),
      }),
      execute: async ({ limit }) => {
        try {
          const guilds = await discord<
            { id: string; name: string; icon?: string | null; owner: boolean; permissions: string }[]
          >(`/users/@me/guilds?limit=${limit}`)
          return {
            count: guilds.length,
            servers: guilds.map((g) => ({
              id: g.id,
              name: g.name,
              isOwner: g.owner,
              iconUrl: g.icon
                ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`
                : null,
            })),
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "discord-getServer": tool({
      description: "Get details about a specific Discord server by its ID.",
      parameters: z.object({
        serverId: z.string().describe("Discord server (guild) ID"),
      }),
      execute: async ({ serverId }) => {
        try {
          const guild = await discord<{
            id: string
            name: string
            description?: string | null
            approximate_member_count?: number
            icon?: string | null
          }>(`/guilds/${serverId}?with_counts=true`)
          return {
            id: guild.id,
            name: guild.name,
            description: guild.description ?? null,
            memberCount: guild.approximate_member_count ?? null,
            iconUrl: guild.icon
              ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
              : null,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "discord-listChannels": tool({
      description: "List text channels in a Discord server the user belongs to.",
      parameters: z.object({
        serverId: z.string().describe("Discord server (guild) ID"),
      }),
      execute: async ({ serverId }) => {
        try {
          const channels = await discord<
            { id: string; name: string; type: number; topic?: string | null; position: number }[]
          >(`/guilds/${serverId}/channels`)
          // type 0 = GUILD_TEXT, type 5 = GUILD_ANNOUNCEMENT
          const textChannels = channels
            .filter((c) => c.type === 0 || c.type === 5)
            .sort((a, b) => a.position - b.position)
            .map((c) => ({ id: c.id, name: c.name, topic: c.topic ?? null }))
          return { count: textChannels.length, channels: textChannels }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),
  }
}

export const discordConnectorDef: ConnectorDef = {
  id: "discord-connector",
  name: "Discord",
  category: "communication",
  icon: "discord",
  description: "View your Discord profile, list servers, and browse channels.",
  readOnlyByDefault: true,
  auth: {
    kind: "oauth2",
    authUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    scopes: ["identify", "guilds", "guilds.channels.read"],
    clientIdEnv: "DISCORD_INTEGRATIONS_CLIENT_ID",
    clientSecretEnv: "DISCORD_INTEGRATIONS_CLIENT_SECRET",
    redirectPath: "/api/integrations/callback/discord-connector",
    tokenRequestAuth: "body",
  },
  setup: {
    providerConsoleUrl: "https://discord.com/developers/applications",
    steps: [
      "Go to discord.com/developers/applications → New Application",
      "Under OAuth2 → Redirects, add: ${BACKEND_URL}/api/integrations/callback/discord-connector",
      "Copy the Client ID and Client Secret from the OAuth2 General page",
    ],
    collect: [
      { env: "DISCORD_INTEGRATIONS_CLIENT_ID", label: "Discord OAuth Client ID", secret: false },
      { env: "DISCORD_INTEGRATIONS_CLIENT_SECRET", label: "Discord OAuth Client Secret", secret: true },
    ],
    docsUrl: "https://discord.com/developers/docs/topics/oauth2",
  },
  tools: createDiscordTools,
}
