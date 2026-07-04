import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError, gateWrite } from "./connector-def.js"

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
    "slack-listChannels": tool({
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

    "slack-searchMessages": tool({
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

    "slack-listUsers": tool({
      description: "List members in the Slack workspace. Returns user ID, display name, and online status.",
      parameters: z.object({
        limit: z.number().int().min(1).max(100).default(20).describe("Max users to return"),
        cursor: z.string().optional().describe("Pagination cursor from previous call"),
      }),
      execute: async ({ limit, cursor }) => {
        try {
          const params = new URLSearchParams({ limit: String(limit) })
          if (cursor) params.set("cursor", cursor)
          const data = await slack<{
            members?: {
              id: string
              name: string
              real_name?: string
              profile?: { display_name?: string; image_72?: string }
              deleted: boolean
              is_bot: boolean
            }[]
            response_metadata?: { next_cursor?: string }
          }>(`/users.list?${params}`)
          const members = (data.members ?? [])
            .filter((m) => !m.deleted && !m.is_bot)
            .map((m) => ({
              id: m.id,
              name: m.real_name ?? m.profile?.display_name ?? m.name,
              displayName: m.profile?.display_name ?? "",
              avatar: m.profile?.image_72 ?? null,
            }))
          return {
            count: members.length,
            members,
            nextCursor: data.response_metadata?.next_cursor ?? null,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "slack-sendMessage": tool({
      description: "Send a message to a Slack channel or DM. Only available when write access is granted.",
      parameters: z.object({
        channel: z.string().describe("Channel ID or name (e.g. #general or C01234567)"),
        text: z.string().max(3000).describe("Message text (supports Slack mrkdwn formatting)"),
      }),
      execute: async (args) => {
        const { channel, text } = args
        return gateWrite(
          ctx,
          {
            connector: "slack",
            action: "slack-sendMessage",
            risk: "write",
            title: `Send Slack message to ${channel}`,
            preview: `To: ${channel}\n\n${text.slice(0, 500)}`,
            confirmText: "Send message",
          },
          args,
          async () => {
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
        )
      },
    }),

    "slack-getChannelHistory": tool({
      description: "Fetch recent messages from a Slack channel. Returns message text, author, and timestamps.",
      parameters: z.object({
        channel: z.string().describe("Channel ID (e.g. C01234567)"),
        limit: z.number().int().min(1).max(50).default(20).describe("Max messages to return"),
      }),
      execute: async ({ channel, limit }) => {
        try {
          const params = new URLSearchParams({ channel, limit: String(limit) })
          const data = await slack<{
            messages?: {
              ts: string
              text: string
              user?: string
              username?: string
              bot_id?: string
              thread_ts?: string
              reply_count?: number
            }[]
            has_more?: boolean
          }>(`/conversations.history?${params}`)
          const messages = (data.messages ?? []).map((m) => ({
            ts: m.ts,
            text: m.text,
            userId: m.user ?? m.bot_id ?? null,
            username: m.username ?? null,
            threadTs: m.thread_ts ?? null,
            replyCount: m.reply_count ?? 0,
          }))
          if (messages.length === 0) return { messages: [], message: "No messages found in this channel." }
          return { count: messages.length, messages, hasMore: data.has_more ?? false }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "slack-getThread": tool({
      description: "Fetch all replies in a Slack thread by providing the channel ID and thread timestamp.",
      parameters: z.object({
        channel: z.string().describe("Channel ID (e.g. C01234567)"),
        threadTs: z.string().describe("Thread timestamp (ts of the parent message)"),
        limit: z.number().int().min(1).max(50).default(20).describe("Max replies to return"),
      }),
      execute: async ({ channel, threadTs, limit }) => {
        try {
          const params = new URLSearchParams({ channel, ts: threadTs, limit: String(limit) })
          const data = await slack<{
            messages?: {
              ts: string
              text: string
              user?: string
              username?: string
              bot_id?: string
            }[]
          }>(`/conversations.replies?${params}`)
          const messages = (data.messages ?? []).map((m) => ({
            ts: m.ts,
            text: m.text,
            userId: m.user ?? m.bot_id ?? null,
            username: m.username ?? null,
          }))
          if (messages.length === 0) return { messages: [], message: "No replies found in this thread." }
          return { count: messages.length, messages }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "slack-getUserInfo": tool({
      description: "Get detailed information about a Slack user by their user ID. Returns name, email, display name, timezone, and profile photo.",
      parameters: z.object({
        userId: z.string().describe("Slack user ID (e.g. U01234567)"),
      }),
      execute: async ({ userId }) => {
        try {
          const data = await slack<{
            user?: {
              id: string
              name: string
              real_name?: string
              profile?: {
                display_name?: string
                email?: string
                image_72?: string
                image_192?: string
                status_text?: string
                status_emoji?: string
                phone?: string
                title?: string
              }
              tz?: string
              tz_label?: string
              deleted?: boolean
              is_bot?: boolean
              updated?: number
            }
          }>(`/users.info?user=${encodeURIComponent(userId)}`)
          const u = data.user
          if (!u) return { error: "User not found" }
          return {
            id: u.id,
            name: u.name,
            realName: u.real_name ?? null,
            displayName: u.profile?.display_name ?? null,
            email: u.profile?.email ?? null,
            avatar: u.profile?.image_192 ?? u.profile?.image_72 ?? null,
            status: u.profile?.status_text ?? null,
            statusEmoji: u.profile?.status_emoji ?? null,
            title: u.profile?.title ?? null,
            timezone: u.tz ?? null,
            deleted: u.deleted ?? false,
            isBot: u.is_bot ?? false,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "slack-uploadFile": tool({
      description:
        "Upload a file to a Slack channel. Provide the file content as text and a filename. The file will appear as a posted file in the channel.",
      parameters: z.object({
        channel: z.string().describe("Channel ID (e.g. C01234567) to upload the file to"),
        content: z.string().describe("Text content of the file"),
        filename: z.string().describe("Filename including extension (e.g. 'report.txt')"),
        title: z.string().optional().describe("Title for the file (defaults to filename)"),
        filetype: z.string().optional().describe("File type (e.g. 'text', 'json', 'csv', 'markdown'). Auto-detected from extension if omitted."),
        initialComment: z.string().optional().describe("Optional message to post with the file"),
      }),
      execute: async (args) => {
        const { channel, content, filename, title, filetype, initialComment } = args
        return gateWrite(
          ctx,
          {
            connector: "slack",
            action: "slack-uploadFile",
            risk: "write",
            title: `Upload file ${filename} to Slack`,
            preview: `Upload "${filename}" to channel ${channel}${initialComment ? ` with comment: ${initialComment.slice(0, 200)}` : ""}`,
            confirmText: "Upload file",
          },
          args,
          async () => {
            try {
              const token = await ctx.getAccessToken(ctx.userId, "slack")
              const boundary = `yomi_slack_${Date.now()}`
              const parts = [
                `--${boundary}\r\nContent-Disposition: form-data; name="content"\r\n\r\n${content}`,
                `--${boundary}\r\nContent-Disposition: form-data; name="filename"\r\n\r\n${filename}`,
                `--${boundary}\r\nContent-Disposition: form-data; name="channels"\r\n\r\n${channel}`,
              ]
              if (title) parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}`)
              if (filetype) parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="filetype"\r\n\r\n${filetype}`)
              if (initialComment) parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="initial_comment"\r\n\r\n${initialComment}`)
              parts.push(`--${boundary}--`)

              const res = await fetch("https://slack.com/api/files.upload", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": `multipart/form-data; boundary=${boundary}`,
                },
                body: parts.join("\r\n"),
              })
              if (!res.ok) throw new Error(`Slack upload HTTP ${res.status}`)
              const data = (await res.json()) as { ok: boolean; error?: string; file?: { id: string; permalink?: string; name?: string } }
              if (!data.ok) throw new Error(`Slack upload error: ${data.error ?? "unknown"}`)
              return { ok: true, fileId: data.file?.id, permalink: data.file?.permalink, name: data.file?.name ?? filename }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "slack-replyInThread": tool({
      description: "Reply to a message thread in Slack. Provide the channel ID and the parent message's thread timestamp.",
      parameters: z.object({
        channel: z.string().describe("Channel ID (e.g. C01234567)"),
        threadTs: z.string().describe("Thread timestamp of the parent message (ts)"),
        text: z.string().max(3000).describe("Reply text (supports Slack mrkdwn formatting)"),
      }),
      execute: async (args) => {
        const { channel, threadTs, text } = args
        return gateWrite(
          ctx,
          {
            connector: "slack",
            action: "slack-replyInThread",
            risk: "write",
            title: `Reply in Slack thread`,
            preview: `Channel: ${channel}\nThread: ${threadTs}\n\n${text.slice(0, 500)}`,
            confirmText: "Post reply",
          },
          args,
          async () => {
            try {
              const data = await slack<{ channel?: string; ts?: string }>(`/chat.postMessage`, {
                method: "POST",
                body: JSON.stringify({ channel, text, thread_ts: threadTs }),
              })
              return { ok: true, channel: data.channel, ts: data.ts, message: "Reply posted." }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
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
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    // No bot scopes — we store the user token (authed_user.access_token).
    // All permissions must be user scopes so the stored credential covers them.
    scopes: [],
    clientIdEnv: "SLACK_CLIENT_ID",
    clientSecretEnv: "SLACK_CLIENT_SECRET",
    redirectPath: "/api/integrations/callback/slack",
    extraAuthParams: { "user_scope": "search:read channels:read users:read chat:write" },
  },
  setup: {
    providerConsoleUrl: "https://api.slack.com/apps",
    steps: [
      "Go to api.slack.com/apps → Create New App → From scratch",
      "Add OAuth Redirect URL: ${BACKEND_URL}/api/integrations/callback/slack",
      "Under OAuth & Permissions → User Token Scopes: search:read, channels:read, users:read, chat:write",
      "No Bot Token Scopes needed — Yomi uses the user token",
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
