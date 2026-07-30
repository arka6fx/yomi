import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const OUTLOOK_TOOLKIT = "outlook"

export const outlookComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  {
    slug: "OUTLOOK_OUTLOOK_GET_PROFILE",
    description: "Get the signed-in user's Outlook profile. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "OUTLOOK_OUTLOOK_LIST_MESSAGES",
    description: "List email messages from a mail folder, with filtering. Read-only.",
    parameters: z
      .object({
        folder: z.string().optional().describe("Mail folder, e.g. 'inbox'"),
        top: z.number().int().optional().describe("Max results"),
        is_read: z.boolean().optional().describe("Filter by read status"),
        from_address: z.string().optional().describe("Filter by sender"),
      })
      .passthrough(),
  },
  {
    slug: "OUTLOOK_OUTLOOK_GET_MESSAGE",
    description: "Get a specific email message. Read-only.",
    parameters: z.object({ message_id: z.string().describe("Message ID") }).passthrough(),
  },
  {
    slug: "OUTLOOK_OUTLOOK_SEARCH_MESSAGES",
    description: "Search messages by sender, subject, or content. Read-only.",
    parameters: z.object({ query: z.string().describe("Search query") }).passthrough(),
  },
  {
    slug: "OUTLOOK_OUTLOOK_LIST_MAIL_FOLDERS",
    description: "List top-level mail folders (inbox, drafts, sent). Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "OUTLOOK_LIST_OUTLOOK_ATTACHMENTS",
    description: "List attachment metadata for a message. Read-only.",
    parameters: z.object({ message_id: z.string().describe("Message ID") }).passthrough(),
  },
  {
    slug: "OUTLOOK_DOWNLOAD_OUTLOOK_ATTACHMENT",
    description: "Download a specific attachment from a message. Read-only.",
    parameters: z
      .object({
        message_id: z.string().describe("Message ID"),
        attachment_id: z.string().describe("Attachment ID"),
        file_name: z.string().describe("Filename to save as"),
      })
      .passthrough(),
  },
  {
    slug: "OUTLOOK_LIST_CALENDARS",
    description: "List calendars in the user's mailbox. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "OUTLOOK_OUTLOOK_LIST_EVENTS",
    description: "List events from the user's calendar. Read-only.",
    parameters: z
      .object({ top: z.number().int().optional().describe("Max results") })
      .passthrough(),
  },
  {
    slug: "OUTLOOK_OUTLOOK_GET_EVENT",
    description: "Get details of a specific calendar event. Read-only.",
    parameters: z.object({ event_id: z.string().describe("Event ID") }).passthrough(),
  },
  {
    slug: "OUTLOOK_OUTLOOK_GET_SCHEDULE",
    description: "Get free/busy schedule information for email addresses. Read-only.",
    parameters: z
      .object({
        Schedules: z.array(z.string()).describe("Email addresses to check"),
        StartTime: z.record(z.string(), z.unknown()).describe("Start of time window"),
        EndTime: z.record(z.string(), z.unknown()).describe("End of time window"),
      })
      .passthrough(),
  },
  {
    slug: "OUTLOOK_OUTLOOK_LIST_CONTACTS",
    description: "List the user's Outlook contacts. Read-only.",
    parameters: z
      .object({ top: z.number().int().optional().describe("Max results") })
      .passthrough(),
  },
  {
    slug: "OUTLOOK_OUTLOOK_GET_CONTACT",
    description: "Get details of a specific contact. Read-only.",
    parameters: z.object({ contact_id: z.string().describe("Contact ID") }).passthrough(),
  },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "OUTLOOK_OUTLOOK_SEND_EMAIL",
    description: "Send an email via Outlook. Requires user approval before it runs.",
    parameters: z
      .object({
        to_email: z.string().describe("Recipient email"),
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email body"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Send email",
      preview: `Send "${String(a["subject"] ?? "")}" to ${String(a["to_email"] ?? "")}`,
      confirmText: "Send",
    }),
  },
  {
    slug: "OUTLOOK_OUTLOOK_CREATE_DRAFT",
    description: "Create an email draft. Requires user approval before it runs.",
    parameters: z
      .object({
        to_recipients: z.array(z.string()).describe("Recipient emails"),
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email body"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create draft",
      preview: `Draft "${String(a["subject"] ?? "")}"`,
      confirmText: "Create draft",
    }),
  },
  {
    slug: "OUTLOOK_OUTLOOK_REPLY_EMAIL",
    description: "Send a reply to an email message. Requires user approval before it runs.",
    parameters: z
      .object({
        message_id: z.string().describe("Message ID to reply to"),
        comment: z.string().describe("Reply text"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Reply to email",
      preview: `Reply to ${String(a["message_id"] ?? "")}`,
      confirmText: "Reply",
    }),
  },
  {
    slug: "OUTLOOK_OUTLOOK_MOVE_MESSAGE",
    description: "Move a message to another folder. Requires user approval before it runs.",
    parameters: z
      .object({
        message_id: z.string().describe("Message ID"),
        destination_id: z.string().describe("Destination folder ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Move message",
      preview: `Move message ${String(a["message_id"] ?? "")}`,
      confirmText: "Move",
    }),
  },
  {
    slug: "OUTLOOK_OUTLOOK_CALENDAR_CREATE_EVENT",
    description: "Create a new calendar event. Requires user approval before it runs.",
    parameters: z
      .object({
        subject: z.string().describe("Event subject"),
        start_datetime: z.string().describe("Start time (ISO 8601)"),
        end_datetime: z.string().describe("End time (ISO 8601)"),
        time_zone: z.string().describe("Time zone"),
        body: z.string().describe("Event description"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create event",
      preview: `Create event "${String(a["subject"] ?? "")}"`,
      confirmText: "Create event",
    }),
  },
  {
    slug: "OUTLOOK_OUTLOOK_UPDATE_CALENDAR_EVENT",
    description: "Update an existing calendar event. Requires user approval before it runs.",
    parameters: z.object({ event_id: z.string().describe("Event ID") }).passthrough(),
    preview: (a) => ({
      title: "Update event",
      preview: `Update event ${String(a["event_id"] ?? "")}`,
      confirmText: "Update event",
    }),
  },
  {
    slug: "OUTLOOK_OUTLOOK_CREATE_CONTACT",
    description: "Create a new contact. Requires user approval before it runs.",
    parameters: z
      .object({
        givenName: z.string().optional().describe("First name"),
        surname: z.string().optional().describe("Last name"),
        emailAddresses: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe("Email addresses"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create contact",
      preview: `Create contact ${String(a["givenName"] ?? "")} ${String(a["surname"] ?? "")}`,
      confirmText: "Create contact",
    }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "OUTLOOK_OUTLOOK_DELETE_EVENT",
    description: "Delete a calendar event. This cannot be undone.",
    parameters: z.object({ event_id: z.string().describe("Event ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete event",
      preview: `Delete event ${String(a["event_id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
  {
    slug: "OUTLOOK_OUTLOOK_DELETE_CONTACT",
    description: "Permanently delete a contact. This cannot be undone.",
    parameters: z.object({ contact_id: z.string().describe("Contact ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete contact",
      preview: `Delete contact ${String(a["contact_id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
  {
    slug: "OUTLOOK_DELETE_MAIL_FOLDER",
    description: "Delete a mail folder. This cannot be undone.",
    parameters: z.object({ folder_id: z.string().describe("Folder ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete mail folder",
      preview: `Delete folder ${String(a["folder_id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
]

export function makeComposioOutlookDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "outlook",
    name: "Outlook",
    category: "email",
    icon: "outlook",
    description:
      "Read and send email, manage calendar events and contacts via Microsoft Outlook (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: OUTLOOK_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_OUTLOOK_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create an Outlook auth config in Composio (uses Microsoft OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_OUTLOOK_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=outlook to route Outlook through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_OUTLOOK_AUTH_CONFIG_ID",
          label: "Composio Outlook auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/tools/outlook",
    },
    tools: createComposioTools({
      provider: "outlook",
      toolkit: OUTLOOK_TOOLKIT,
      specs: outlookComposioSpecs,
      executor,
    }),
  }
}
