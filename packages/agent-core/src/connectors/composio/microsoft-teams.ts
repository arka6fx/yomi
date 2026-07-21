import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

// Composio's real toolkit slug is "microsoft_teams" (underscore) — verified
// against the live tools catalog, not "microsoft-teams".
export const MICROSOFT_TEAMS_TOOLKIT = "microsoft_teams"

export const microsoftTeamsComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  { slug: "MICROSOFT_TEAMS_TEAMS_LIST", description: "List Microsoft Teams accessible by the authenticated user. Read-only.", parameters: z.object({ top: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "MICROSOFT_TEAMS_GET_TEAM", description: "Get details of a specific team. Read-only.", parameters: z.object({ team_id: z.string().describe("Team ID") }).passthrough() },
  { slug: "MICROSOFT_TEAMS_LIST_TEAM_MEMBERS", description: "List members of a team. Read-only.", parameters: z.object({ team_id: z.string().describe("Team ID"), top: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "MICROSOFT_TEAMS_TEAMS_LIST_CHANNELS", description: "List channels in a team. Read-only.", parameters: z.object({ team_id: z.string().describe("Team ID") }).passthrough() },
  { slug: "MICROSOFT_TEAMS_GET_CHANNEL", description: "Get details of a specific channel. Read-only.", parameters: z.object({ team_id: z.string().describe("Team ID"), channel_id: z.string().describe("Channel ID") }).passthrough() },
  { slug: "MICROSOFT_TEAMS_TEAMS_GET_MESSAGE", description: "Get a specific channel message. Read-only.", parameters: z.object({ team_id: z.string().describe("Team ID"), channel_id: z.string().describe("Channel ID"), message_id: z.string().describe("Message ID") }).passthrough() },
  { slug: "MICROSOFT_TEAMS_LIST_MESSAGE_REPLIES", description: "List replies to a channel message. Read-only.", parameters: z.object({ team_id: z.string().describe("Team ID"), channel_id: z.string().describe("Channel ID"), message_id: z.string().describe("Message ID") }).passthrough() },
  { slug: "MICROSOFT_TEAMS_CHATS_GET_ALL_CHATS", description: "List chats a user is part of. Read-only.", parameters: z.object({ user_id: z.string().optional().describe("User ID (defaults to signed-in user)") }).passthrough() },
  { slug: "MICROSOFT_TEAMS_TEAMS_LIST_CHAT_MESSAGES", description: "List messages (newest first) from a chat. Read-only.", parameters: z.object({ chat_id: z.string().describe("Chat ID"), top: z.number().int().optional().describe("Max results") }).passthrough() },
  { slug: "MICROSOFT_TEAMS_CHATS_GET_ALL_MESSAGES", description: "Get all messages from a chat. Read-only.", parameters: z.object({ chat_id: z.string().describe("Chat ID") }).passthrough() },
  { slug: "MICROSOFT_TEAMS_GET_CHAT_MESSAGE", description: "Get a specific chat message. Read-only.", parameters: z.object({ chat_id: z.string().describe("Chat ID"), message_id: z.string().describe("Message ID") }).passthrough() },
  { slug: "MICROSOFT_TEAMS_LIST_USERS", description: "List users in the organization directory. Read-only.", parameters: z.object({ ["$top"]: z.number().int().optional().describe("Max results"), ["$filter"]: z.string().optional().describe("OData filter") }).passthrough() },
  { slug: "MICROSOFT_TEAMS_LIST_TEAMS_TEMPLATES", description: "List available team templates. Read-only.", parameters: z.object({}).passthrough() },
  { slug: "MICROSOFT_TEAMS_TEAMS_LIST_PEOPLE", description: "List people relevant to a user (from Microsoft Graph). Read-only.", parameters: z.object({ search: z.string().optional().describe("Search term") }).passthrough() },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "MICROSOFT_TEAMS_CREATE_TEAM",
    description: "Create a new Microsoft Teams team. Requires user approval before it runs.",
    parameters: z.object({ displayName: z.string().describe("Team name"), visibility: z.string().describe("'private' or 'public'"), description: z.string().optional().describe("Team description") }).passthrough(),
    preview: (a) => ({ title: "Create team", preview: `Create team "${String(a["displayName"] ?? "")}"`, confirmText: "Create team" }),
  },
  {
    slug: "MICROSOFT_TEAMS_ADD_MEMBER_TO_TEAM",
    description: "Add a user to a team. Requires user approval before it runs.",
    parameters: z.object({ team_id: z.string().describe("Team ID"), user_id: z.string().describe("User ID to add") }).passthrough(),
    preview: (a) => ({ title: "Add team member", preview: `Add ${String(a["user_id"] ?? "")} to team ${String(a["team_id"] ?? "")}`, confirmText: "Add" }),
  },
  {
    slug: "MICROSOFT_TEAMS_TEAMS_CREATE_CHANNEL",
    description: "Create a new channel within a team. Requires user approval before it runs.",
    parameters: z.object({ team_id: z.string().describe("Team ID"), name: z.string().describe("Channel name"), description: z.string().optional().describe("Channel description") }).passthrough(),
    preview: (a) => ({ title: "Create channel", preview: `Create channel "${String(a["name"] ?? "")}"`, confirmText: "Create channel" }),
  },
  {
    slug: "MICROSOFT_TEAMS_TEAMS_CREATE_CHAT",
    description: "Create a new chat (or return an existing one-on-one chat). Requires user approval before it runs.",
    parameters: z.object({ members: z.array(z.record(z.string(), z.unknown())).describe("Chat members"), chatType: z.string().describe("'oneOnOne' or 'group'") }).passthrough(),
    preview: () => ({ title: "Create chat", preview: "Create a new chat", confirmText: "Create chat" }),
  },
  {
    slug: "MICROSOFT_TEAMS_CREATE_MEETING",
    description: "Schedule a new standalone Teams online meeting. Requires user approval before it runs.",
    parameters: z.object({ subject: z.string().describe("Meeting subject"), start_date_time: z.string().describe("Start time (ISO 8601)"), end_date_time: z.string().describe("End time (ISO 8601)") }).passthrough(),
    preview: (a) => ({ title: "Create meeting", preview: `Schedule "${String(a["subject"] ?? "")}"`, confirmText: "Schedule meeting" }),
  },
  {
    slug: "MICROSOFT_TEAMS_TEAMS_POST_CHANNEL_MESSAGE",
    description: "Post a message to a channel. Requires user approval before it runs.",
    parameters: z.object({ team_id: z.string().describe("Team ID"), channel_id: z.string().describe("Channel ID"), content: z.string().describe("Message content") }).passthrough(),
    preview: (a) => ({ title: "Post channel message", preview: String(a["content"] ?? "").slice(0, 100), confirmText: "Post" }),
  },
  {
    slug: "MICROSOFT_TEAMS_TEAMS_POST_CHAT_MESSAGE",
    description: "Send a message to a chat. Requires user approval before it runs.",
    parameters: z.object({ chat_id: z.string().describe("Chat ID"), content: z.string().describe("Message content") }).passthrough(),
    preview: (a) => ({ title: "Post chat message", preview: String(a["content"] ?? "").slice(0, 100), confirmText: "Send" }),
  },
  {
    slug: "MICROSOFT_TEAMS_TEAMS_POST_MESSAGE_REPLY",
    description: "Reply to an existing channel message. Requires user approval before it runs.",
    parameters: z.object({ team_id: z.string().describe("Team ID"), channel_id: z.string().describe("Channel ID"), message_id: z.string().describe("Message ID to reply to"), content: z.string().describe("Reply content") }).passthrough(),
    preview: (a) => ({ title: "Reply to message", preview: String(a["content"] ?? "").slice(0, 100), confirmText: "Reply" }),
  },
  {
    slug: "MICROSOFT_TEAMS_UPDATE_CHANNEL_MESSAGE",
    description: "Update a channel message. Requires user approval before it runs.",
    parameters: z.object({ team_id: z.string().describe("Team ID"), channel_id: z.string().describe("Channel ID"), message_id: z.string().describe("Message ID"), content: z.string().describe("New content") }).passthrough(),
    preview: (a) => ({ title: "Update channel message", preview: `Update message ${String(a["message_id"] ?? "")}`, confirmText: "Update" }),
  },
  {
    slug: "MICROSOFT_TEAMS_UPDATE_CHAT_MESSAGE",
    description: "Update a chat message. Requires user approval before it runs.",
    parameters: z.object({ chat_id: z.string().describe("Chat ID"), message_id: z.string().describe("Message ID"), content: z.string().describe("New content") }).passthrough(),
    preview: (a) => ({ title: "Update chat message", preview: `Update message ${String(a["message_id"] ?? "")}`, confirmText: "Update" }),
  },
  {
    slug: "MICROSOFT_TEAMS_UPDATE_TEAM",
    description: "Update a team's settings. Requires user approval before it runs.",
    parameters: z.object({ team_id: z.string().describe("Team ID") }).passthrough(),
    preview: (a) => ({ title: "Update team", preview: `Update team ${String(a["team_id"] ?? "")}`, confirmText: "Update" }),
  },
  {
    slug: "MICROSOFT_TEAMS_ARCHIVE_TEAM",
    description: "Archive a team. Requires user approval before it runs.",
    parameters: z.object({ team_id: z.string().describe("Team ID") }).passthrough(),
    preview: (a) => ({ title: "Archive team", preview: `Archive team ${String(a["team_id"] ?? "")}`, confirmText: "Archive" }),
  },
  {
    slug: "MICROSOFT_TEAMS_UNARCHIVE_TEAM",
    description: "Restore an archived team to active state. Requires user approval before it runs.",
    parameters: z.object({ team_id: z.string().describe("Team ID") }).passthrough(),
    preview: (a) => ({ title: "Unarchive team", preview: `Unarchive team ${String(a["team_id"] ?? "")}`, confirmText: "Unarchive" }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "MICROSOFT_TEAMS_DELETE_TEAM",
    description: "Permanently delete a team. This cannot be undone.",
    parameters: z.object({ team_id: z.string().describe("Team ID") }).passthrough(),
    preview: (a) => ({ title: "Delete team", preview: `Delete team ${String(a["team_id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
]

export function makeComposioMicrosoftTeamsDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "microsoft-teams",
    name: "Microsoft Teams",
    category: "communication",
    icon: "microsoft-teams",
    description: "Microsoft Teams — team chat and collaboration; manage teams, channels, chats, meetings, and messages (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: MICROSOFT_TEAMS_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_MICROSOFT_TEAMS_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Microsoft Teams auth config in Composio (uses Microsoft OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_MICROSOFT_TEAMS_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=microsoft-teams to route Microsoft Teams through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_MICROSOFT_TEAMS_AUTH_CONFIG_ID", label: "Composio Microsoft Teams auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/microsoft_teams",
    },
    tools: createComposioTools({
      provider: "microsoft-teams",
      toolkit: MICROSOFT_TEAMS_TOOLKIT,
      specs: microsoftTeamsComposioSpecs,
      executor,
    }),
  }
}
