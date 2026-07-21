import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const DISCORD_TOOLKIT = "discord"

// Real Discord catalog is read-only profile/guild info — no message sending,
// channel management, or moderation actions currently exist in Composio.
export const discordComposioSpecs: ComposioToolSpec[] = [
  {
    slug: "DISCORD_GET_MY_USER",
    description: "Get the authenticated Discord user's profile. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "DISCORD_LIST_MY_GUILDS",
    description: "List servers (guilds) the authenticated user is a member of. Read-only.",
    parameters: z.object({ limit: z.number().int().optional().describe("Max results") }).passthrough(),
  },
  {
    slug: "DISCORD_GET_MY_GUILD_MEMBER",
    description: "Get the authenticated user's member info within a specific guild. Read-only.",
    parameters: z.object({ guild_id: z.string().describe("Guild (server) ID") }).passthrough(),
  },
  {
    slug: "DISCORD_GET_INVITE",
    description: "Get details about a Discord invite code. Read-only.",
    parameters: z.object({ invite_code: z.string().describe("Invite code") }).passthrough(),
  },
  {
    slug: "DISCORD_LIST_MY_CONNECTIONS",
    description: "List the authenticated user's connected third-party accounts. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "DISCORD_GET_MY_OAUTH2_AUTHORIZATION",
    description: "Get current OAuth2 authorization details (app info, scopes, expiry). Read-only.",
    parameters: z.object({}).passthrough(),
  },
]

export function makeComposioDiscordDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "discord",
    name: "Discord",
    category: "communication",
    icon: "discord",
    description: "Discord — look up your profile, servers, and invites (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: DISCORD_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_DISCORD_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Discord auth config in Composio (uses OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_DISCORD_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=discord to route Discord through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_DISCORD_AUTH_CONFIG_ID", label: "Composio Discord auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/discord",
    },
    tools: createComposioTools({
      provider: "discord",
      toolkit: DISCORD_TOOLKIT,
      specs: discordComposioSpecs,
      executor,
    }),
  }
}
