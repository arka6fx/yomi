import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const DISCORD_TOOLKIT = "discord"

export const discordComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "DISCORD_GET_MY_USER",
    description:
      "Get profile info for the authenticated Discord user. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "DISCORD_LIST_MY_GUILDS",
    description:
      "List Discord servers (guilds) the user is a member of. Read-only.",
    parameters: z
      .object({
        limit: z.number().int().min(1).max(200).optional(),
        before: z.string().optional(),
        after: z.string().optional(),
        with_counts: z.coerce.boolean().optional(),
      })
      .passthrough(),
  },
  {
    slug: "DISCORD_GET_MY_GUILD_MEMBER",
    description:
      "Get the authenticated user's member info in a specific Discord server. Read-only.",
    parameters: z
      .object({
        guild_id: z.string().describe("Discord guild (server) ID"),
      })
      .passthrough(),
  },
  {
    slug: "DISCORD_INVITE_RESOLVE",
    description:
      "Resolve a Discord invite code to get server/channel info. Read-only.",
    parameters: z
      .object({
        code: z.string().describe("Invite code or full URL"),
        with_counts: z.coerce.boolean().optional(),
      })
      .passthrough(),
  },
  {
    slug: "DISCORD_LIST_MY_CONNECTIONS",
    description:
      "List the authenticated user's connected third-party accounts on Discord. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "DISCORD_GET_USER",
    description:
      "Get information about a Discord user by ID. Read-only.",
    parameters: z
      .object({
        user_id: z.string().describe("User ID (use '@me' for current user)"),
      })
      .passthrough(),
  },
  {
    slug: "DISCORD_GET_GUILD_WIDGET",
    description:
      "Get a Discord guild's widget in JSON format. Read-only.",
    parameters: z
      .object({
        guild_id: z.string().describe("Discord guild ID"),
      })
      .passthrough(),
  },
  {
    slug: "DISCORD_LIST_STICKER_PACKS",
    description:
      "List all available Discord Nitro sticker packs. Read-only.",
    parameters: z.object({}).passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "DISCORD_MODIFY_CURRENT_USER",
    description:
      "Update the authenticated user's Discord profile (username or avatar). Requires user approval before it runs.",
    parameters: z
      .object({
        username: z.string().optional().describe("New username (2 changes/hour limit)"),
        avatar: z.string().optional().describe("Base64-encoded image data URI for new avatar"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update Discord profile",
      preview: `Update ${a["username"] ? `username to ${String(a["username"])}` : "avatar"}`,
      confirmText: "Update profile",
    }),
  },
  {
    slug: "DISCORD_LEAVE_GUILD",
    description:
      "Leave a Discord server (guild). Requires user approval before it runs.",
    parameters: z
      .object({
        guild_id: z.string().describe("Discord guild ID to leave"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Leave Discord server",
      preview: `Leave guild ${String(a["guild_id"] ?? "")}`,
      confirmText: "Leave server",
    }),
  },
]

export function makeComposioDiscordDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "discord",
    name: "Discord",
    category: "communication",
    icon: "discord",
    description: "List servers, get member info, resolve invites, and manage Discord profile (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: DISCORD_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_DISCORD_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Discord OAuth app in the Discord Developer Portal",
        "Set up a custom auth config in Composio with your Discord client ID and secret",
        "Set COMPOSIO_API_KEY and COMPOSIO_DISCORD_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=discord to route Discord through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_DISCORD_AUTH_CONFIG_ID", label: "Composio Discord auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/discord",
    },
    tools: createComposioTools({
      provider: "discord",
      toolkit: DISCORD_TOOLKIT,
      specs: discordComposioSpecs,
      executor,
    }),
  }
}
