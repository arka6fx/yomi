import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError } from "./connector-def.js"

export function createSlackTools(ctx: ConnectorContext): ToolSet {
  async function slack<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await ctx.getAccessToken(ctx.userId, "slack")
    const res = await fetch(`https://slack.com/api${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      throw new Error(`Slack API ${path} → HTTP ${res.status}`)
    }
    const data = (await res.json()) as { ok: boolean; error?: string } & T
    if (!data.ok) throw new Error(`Slack API ${path} error: ${data.error ?? "unknown"}`)
    return data
  }

  return {
    "slack.listChannels": tool({
      description: "List public Slack channels the bot has access to.",
      parameters: z.object({
        limit: z.number().int().min(1).max(100).default(20).describe("Max channels to return"),
        cursor: z.string().optional().describe("Pagination cursor from previous call"),
      }),
      execute: async ({ limit, cursor }) => {
        try {
          const params = new URLSearchParams({ limit: String(limit), exclude_archived: "true" })
          if (cursor) params.set("cursor", cursor)
          const data = await slack<{
            channels?: { id: string; name: string; is_member: boolean; num_members?: number; topic?: { value: string } }[]
            response_metadata?: { next_cursor?: string }
          }>(`/conversations.list?${params}`)
          const channels = (data.channels ?? []).map((ch) => ({
            id: ch.id,
            name: ch.name,
            members: ch.num_members,
            topic: ch.topic?.value ?? "",
            joined: ch.is_member,
          }))
          return {
            count: channels.length,
            channels,
            nextCursor: data.response_metadata?.next_cursor ?? null,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "slack.searchMessages": tool({
      description: "Search Slack messages across all accessible channels.",
      parameters: z.object({
        query: z.string().describe("Search query (supports Slack search modifiers like in:#channel from:@user)"),
        limit: z.number().int().min(1).max(20).default(10).describe("Max results"),
      }),
      execute: async ({ query, limit }) => {
        try {
          const params = new URLSearchParams({ query, count: String(limit), sort: "timestamp", sort_dir: "desc" })
          const data = await slack<{
            messages?: {
              matches?: {
                ts: string
                text: string
                username?: string
                channel?: { id: string; name: string }
                permalink?: string
              }[]
            }
          }>(`/search.messages?${params}`)
          const matches = (data.messages?.matches ?? []).map((m) => ({
            ts: m.ts,
            text: m.text.slice(0, 500),
            author: m.username ?? "unknown",
            channel: m.channel?.name ?? m.channel?.id ?? "unknown",
            link: m.permalink,
          }))
          if (matches.length === 0) return { results: [], message: "No results found." }
          return { count: matches.length, results: matches }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "slack.sendMessage": tool({
      description: "Send a message to a Slack channel or DM. Only available when write access is granted.",
      parameters: z.object({
        channel: z.string().describe("Channel ID or name (e.g. #general or C01234567)"),
        text: z.string().max(3000).describe("Message text (supports Slack mrkdwn formatting)"),
      }),
      execute: async ({ channel, text }) => {
        try {
          const data = await slack<{ channel?: string; ts?: string }>(`/chat.postMessage`, {
            method: "POST",
            body: JSON.stringify({ channel, text }),
          })
          return { ok: true, channel: data.channel, ts: data.ts }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),
  }
}

export const slackDef: ConnectorDef = {
  id: "slack",
  name: "Slack",
  category: "productivity",
  icon: "slack",
  description: "Search messages, list channels, and send messages in your Slack workspace.",
  readOnlyByDefault: true,
  auth: {
    kind: "oauth2",
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://api.slack.com/methods/oauth.v2.access",
    scopes: ["search:read", "channels:read", "chat:write"],
    clientIdEnv: "SLACK_CLIENT_ID",
    clientSecretEnv: "SLACK_CLIENT_SECRET",
    redirectPath: "/api/integrations/callback/slack",
    // Slack returns the user token under authed_user.access_token for user scopes
    extraAuthParams: { "user_scope": "search:read" },
  },
  setup: {
    providerConsoleUrl: "https://api.slack.com/apps",
    steps: [
      "Go to api.slack.com/apps → Create New App → From scratch",
      "Add OAuth Redirect URL: ${BACKEND_URL}/api/integrations/callback/slack",
      "Under OAuth & Permissions → Bot Token Scopes: channels:read, chat:write",
      "Under User Token Scopes: search:read (search requires user token)",
      "Install to workspace and copy the Client ID and Client Secret",
    ],
    collect: [
      { env: "SLACK_CLIENT_ID", label: "Slack App Client ID", secret: false },
      { env: "SLACK_CLIENT_SECRET", label: "Slack App Client Secret", secret: true },
    ],
    docsUrl: "https://api.slack.com/authentication/oauth-v2",
  },
  tools: createSlackTools,
}
