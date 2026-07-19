import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const SLACK_TOOLKIT = "slack"

export const slackComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "SLACK_LIST_CONVERSATIONS",
    description: "List public Slack channels accessible by the user. Optionally filter by type. Read-only.",
    parameters: z
      .object({
        limit: z.number().int().min(1).max(200).optional().describe("Max channels to return"),
        cursor: z.string().optional().describe("Pagination cursor from previous call"),
        types: z
          .string()
          .optional()
          .describe("Comma-separated types: public_channel, private_channel, im, mpim"),
        exclude_archived: z.coerce.boolean().optional().describe("Exclude archived channels"),
      })
      .passthrough(),
  },
  {
    slug: "SLACK_SEARCH_MESSAGES",
    description:
      "Search Slack messages across all accessible channels. Supports Slack search modifiers like in:#channel from:@user. Read-only.",
    parameters: z
      .object({
        query: z.string().describe("Search query with Slack modifiers"),
        count: z.number().int().min(1).max(100).optional().describe("Max results to return"),
        sort: z.enum(["score", "timestamp"]).optional().describe("Sort by relevance or time"),
        sort_dir: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
      })
      .passthrough(),
  },
  {
    slug: "SLACK_LIST_ALL_USERS",
    description:
      "List all users in the Slack workspace with profile details. Read-only.",
    parameters: z
      .object({
        limit: z.number().int().min(1).max(200).optional().describe("Max users to return (Slack may error on large workspaces if omitted)"),
        cursor: z.string().optional().describe("Pagination cursor from previous call"),
        include_locale: z.coerce.boolean().optional().describe("Include each user's locale, e.g. 'en-US'"),
      })
      .passthrough(),
  },
  {
    slug: "SLACK_FETCH_CONVERSATION_HISTORY",
    description: "Fetch recent messages from a Slack channel. Returns message text and metadata. Read-only.",
    parameters: z
      .object({
        channel: z.string().describe("Channel ID (e.g. C01234567)"),
        limit: z.number().int().min(1).max(100).optional().describe("Max messages to return"),
        cursor: z.string().optional().describe("Pagination cursor from previous call"),
        oldest: z.string().optional().describe("Start timestamp for time range"),
        latest: z.string().optional().describe("End timestamp for time range"),
      })
      .passthrough(),
  },
  {
    slug: "SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION",
    description:
      "Fetch all replies in a Slack thread by providing the channel ID and parent message timestamp. Read-only.",
    parameters: z
      .object({
        channel: z.string().describe("Channel ID (e.g. C01234567)"),
        ts: z.string().describe("Timestamp of the parent message (ts)"),
        limit: z.number().int().min(1).max(100).optional().describe("Max replies to return"),
        cursor: z.string().optional().describe("Pagination cursor from previous call"),
      })
      .passthrough(),
  },
  {
    slug: "SLACK_RETRIEVE_DETAILED_USER_INFORMATION",
    description:
      "Get detailed information about a Slack user by their user ID. Returns name, email, display name, timezone, and profile photo. Read-only.",
    parameters: z
      .object({
        user: z.string().describe("Slack user ID (e.g. U01234567)"),
        include_locale: z.coerce.boolean().optional().describe("Include user locale"),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "SLACK_SEND_MESSAGE",
    description:
      "Send a message to a Slack channel or DM. Supports markdown formatting. Use thread_ts to reply in a thread. Requires user approval before it runs.",
    parameters: z
      .object({
        channel: z.string().describe("Channel ID or name (e.g. C01234567 or #general)"),
        markdown_text: z.string().describe("Message text (supports Slack mrkdwn formatting)"),
        thread_ts: z.string().optional().describe("Timestamp of parent message to reply in thread"),
        reply_broadcast: z.coerce.boolean().optional().describe("Broadcast thread reply to channel"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Send Slack message to ${String(a["channel"] ?? "")}`,
      preview: `To: ${String(a["channel"] ?? "")}${a["thread_ts"] ? ` (thread reply)` : ""}\n\n${String(a["markdown_text"] ?? "").slice(0, 500)}`,
      confirmText: "Send message",
    }),
  },
  {
    slug: "SLACK_UPLOAD_OR_CREATE_A_FILE_IN_SLACK",
    description:
      "Upload a file to a Slack channel. Provide file content as text and a filename. Requires user approval before it runs.",
    parameters: z
      .object({
        channels: z.string().describe("Channel ID (e.g. C01234567) to upload the file to"),
        content: z.string().describe("Text content of the file"),
        filename: z.string().describe("Filename including extension (e.g. 'report.txt')"),
        title: z.string().optional().describe("Title for the file"),
        initial_comment: z.string().optional().describe("Optional message to post with the file"),
        thread_ts: z.string().optional().describe("Timestamp of parent message to reply in thread"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Upload file ${String(a["filename"] ?? "")} to Slack`,
      preview: `Upload "${String(a["filename"] ?? "")}" to channel ${String(a["channels"] ?? "")}${a["initial_comment"] ? ` with comment: ${String(a["initial_comment"]).slice(0, 200)}` : ""}`,
      confirmText: "Upload file",
    }),
  },
]

export function makeComposioSlackDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "slack",
    name: "Slack",
    category: "productivity",
    icon: "slack",
    description: "Search messages, list channels, and send messages in Slack (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: SLACK_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_SLACK_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Slack auth config in Composio (or use the managed one)",
        "Set COMPOSIO_API_KEY and COMPOSIO_SLACK_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=slack to route Slack through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_SLACK_AUTH_CONFIG_ID", label: "Composio Slack auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/slack",
    },
    tools: createComposioTools({
      provider: "slack",
      toolkit: SLACK_TOOLKIT,
      specs: slackComposioSpecs,
      executor,
    }),
  }
}
