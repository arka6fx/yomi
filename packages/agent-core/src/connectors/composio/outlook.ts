import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const OUTLOOK_TOOLKIT = "outlook"

export const outlookComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "OUTLOOK_GET_MY_INFO",
    description:
      "Get the signed-in user's Outlook profile (name, email, mailbox settings). Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "OUTLOOK_LIST_MAIL_FOLDERS",
    description:
      "List all mail folders in the signed-in user's mailbox. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "OUTLOOK_LIST_MESSAGES",
    description:
      "List messages in a specified mail folder. Read-only.",
    parameters: z
      .object({
        folder_id: z.string().optional().describe("Mail folder ID (defaults to Inbox)"),
        top: z.number().int().min(1).max(50).optional().describe("Max messages to return"),
      })
      .passthrough(),
  },
  {
    slug: "OUTLOOK_GET_MESSAGE",
    description:
      "Get a specific email message by ID. Read-only.",
    parameters: z
      .object({
        message_id: z.string().describe("Message ID"),
      })
      .passthrough(),
  },
  {
    slug: "OUTLOOK_SEARCH_MESSAGES",
    description:
      "Search for messages matching a query across the mailbox. Read-only.",
    parameters: z
      .object({
        query: z.string().describe("Search query string"),
        top: z.number().int().min(1).max(50).optional(),
      })
      .passthrough(),
  },
  {
    slug: "OUTLOOK_LIST_CALENDARS",
    description:
      "List all calendars the signed-in user can access. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "OUTLOOK_LIST_CALENDAR_EVENTS",
    description:
      "List events from a calendar within a date range. Read-only.",
    parameters: z
      .object({
        calendar_id: z.string().optional().describe("Calendar ID (defaults to primary)"),
        start_date: z.string().optional().describe("Start date/time (ISO 8601)"),
        end_date: z.string().optional().describe("End date/time (ISO 8601)"),
        top: z.number().int().min(1).max(50).optional(),
      })
      .passthrough(),
  },
  {
    slug: "OUTLOOK_GET_CALENDAR_EVENT",
    description:
      "Get a specific calendar event by ID. Read-only.",
    parameters: z
      .object({
        event_id: z.string().describe("Calendar event ID"),
        calendar_id: z.string().optional().describe("Calendar ID"),
      })
      .passthrough(),
  },
  {
    slug: "OUTLOOK_LIST_CONTACTS",
    description:
      "List contacts from the signed-in user's default contacts folder. Read-only.",
    parameters: z
      .object({
        top: z.number().int().min(1).max(50).optional(),
      })
      .passthrough(),
  },
  {
    slug: "OUTLOOK_GET_CONTACT",
    description:
      "Get a specific contact by ID. Read-only.",
    parameters: z
      .object({
        contact_id: z.string().describe("Contact ID"),
      })
      .passthrough(),
  },

  // ── Send / Write actions (gated) ──────────────────────────────
  {
    slug: "OUTLOOK_SEND_MAIL",
    description:
      "Send a new email message. Requires user approval before it runs.",
    parameters: z
      .object({
        to: z.array(z.string()).describe("List of recipient email addresses"),
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email body content (HTML or plain text)"),
        cc: z.array(z.string()).optional().describe("CC recipients"),
        bcc: z.array(z.string()).optional().describe("BCC recipients"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Send Outlook email",
      preview: `To: ${(a["to"] as string[] | undefined)?.join(", ") ?? ""}\nSubject: ${String(a["subject"] ?? "")}\n\n${String(a["body"] ?? "").slice(0, 500)}`,
      confirmText: "Send email",
    }),
  },
  {
    slug: "OUTLOOK_CREATE_DRAFT",
    description:
      "Create a new email draft without sending. Requires user approval before it runs.",
    parameters: z
      .object({
        to: z.array(z.string()).optional().describe("Recipient email addresses"),
        subject: z.string().optional().describe("Email subject"),
        body: z.string().optional().describe("Email body content"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create Outlook draft",
      preview: `Draft to: ${(a["to"] as string[] | undefined)?.join(", ") ?? ""}\nSubject: ${String(a["subject"] ?? "")}`,
      confirmText: "Create draft",
    }),
  },
  {
    slug: "OUTLOOK_CREATE_DRAFT_REPLY",
    description:
      "Create a reply draft to an existing message. Requires user approval before it runs.",
    parameters: z
      .object({
        message_id: z.string().describe("Message ID to reply to"),
        body: z.string().describe("Reply body content"),
        reply_all: z.boolean().optional().describe("Reply to all recipients"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create Outlook reply draft",
      preview: `Reply to message ${String(a["message_id"] ?? "")}\n\n${String(a["body"] ?? "").slice(0, 500)}`,
      confirmText: "Create reply draft",
    }),
  },
  {
    slug: "OUTLOOK_CALENDAR_CREATE_EVENT",
    description:
      "Create a new calendar event. Requires user approval before it runs.",
    parameters: z
      .object({
        subject: z.string().describe("Event title/subject"),
        body: z.string().optional().describe("Event body/description"),
        start_datetime: z.string().describe("Start date/time (ISO 8601)"),
        end_datetime: z.string().describe("End date/time (ISO 8601)"),
        attendees: z.array(z.string()).optional().describe("Attendee email addresses"),
        location: z.string().optional().describe("Event location"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create Outlook calendar event",
      preview: `${String(a["subject"] ?? "")}\n${String(a["start_datetime"] ?? "")} — ${String(a["end_datetime"] ?? "")}`,
      confirmText: "Create event",
    }),
  },
  {
    slug: "OUTLOOK_ACCEPT_EVENT",
    description:
      "Accept or tentatively accept a calendar meeting invite. Requires user approval before it runs.",
    parameters: z
      .object({
        event_id: z.string().describe("Calendar event ID to accept"),
        tentative: z.boolean().optional().describe("Accept tentatively instead of confirmed"),
        send_response: z.boolean().optional().describe("Send response to organizer (default true)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Accept calendar invite",
      preview: `Accept event ${String(a["event_id"] ?? "")}${a["tentative"] ? " (tentative)" : ""}`,
      confirmText: "Accept",
    }),
  },
  {
    slug: "OUTLOOK_CREATE_CONTACT",
    description:
      "Create a new contact. Requires user approval before it runs.",
    parameters: z
      .object({
        given_name: z.string().describe("First name"),
        surname: z.string().optional().describe("Last name"),
        email: z.string().describe("Email address"),
        phone: z.string().optional().describe("Phone number"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create Outlook contact",
      preview: `${String(a["given_name"] ?? "")} ${String(a["surname"] ?? "")} <${String(a["email"] ?? "")}>`,
      confirmText: "Create contact",
    }),
  },
  {
    slug: "OUTLOOK_CREATE_MAIL_FOLDER",
    description:
      "Create a new mail folder under the root or a parent folder. Requires user approval before it runs.",
    parameters: z
      .object({
        display_name: z.string().describe("Display name for the new folder"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create Outlook folder",
      preview: `Create folder "${String(a["display_name"] ?? "")}"`,
      confirmText: "Create folder",
    }),
  },

  // ── Irreversible actions (gated + warning) ───────────────────
  {
    slug: "OUTLOOK_DELETE_MESSAGE",
    description:
      "Delete an email message permanently. This cannot be undone.",
    parameters: z
      .object({
        message_id: z.string().describe("Message ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete Outlook message",
      preview: `Delete message ${String(a["message_id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
  {
    slug: "OUTLOOK_DELETE_CALENDAR_EVENT",
    description:
      "Delete a calendar event. This cannot be undone.",
    parameters: z
      .object({
        event_id: z.string().describe("Calendar event ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete Outlook calendar event",
      preview: `Delete event ${String(a["event_id"] ?? "")} — this cannot be undone`,
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
    description: "Read and send email, manage calendar events and contacts via Microsoft Outlook (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: OUTLOOK_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_OUTLOOK_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Outlook uses Composio's managed OAuth app — just connect your Microsoft account through the dashboard",
        "Set COMPOSIO_API_KEY and COMPOSIO_OUTLOOK_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=outlook to route Outlook through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_OUTLOOK_AUTH_CONFIG_ID", label: "Composio Outlook auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/outlook",
    },
    tools: createComposioTools({
      provider: "outlook",
      toolkit: OUTLOOK_TOOLKIT,
      specs: outlookComposioSpecs,
      executor,
    }),
  }
}
