import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const GMAIL_TOOLKIT = "gmail"

export const gmailComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "GMAIL_FETCH_EMAILS",
    description:
      "Search Gmail for emails matching a query string. Supports Gmail search operators like from:, subject:, after:, before:, has:attachment, is:unread. Omit the query to list recent mail. Returns matching emails with ID, sender, subject, date, and snippet. Read-only.",
    parameters: z
      .object({
        query: z
          .string()
          .optional()
          .describe("Gmail search query, e.g. 'from:boss@example.com is:unread'"),
        max_results: z.number().int().min(1).max(50).optional().describe("Max results to return"),
      })
      .passthrough(),
  },
  {
    slug: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
    description:
      "Read the full content of a single Gmail message by its ID. Returns the full body, headers, metadata, and attachments. Read-only.",
    parameters: z
      .object({
        message_id: z.string().describe("The Gmail message ID from a search result"),
      })
      .passthrough(),
  },
  {
    slug: "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
    description:
      "Fetch all messages in a Gmail thread by thread ID. Returns messages in chronological order with full body and headers. Read-only.",
    parameters: z
      .object({
        thread_id: z.string().describe("The Gmail thread ID"),
      })
      .passthrough(),
  },
  {
    slug: "GMAIL_LIST_LABELS",
    description:
      "List all Gmail labels (both system and user-defined) with their ID, name, and type. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "GMAIL_LIST_DRAFTS",
    description:
      "List all email drafts in Gmail. Returns draft IDs with subject, sender, and date. Read-only.",
    parameters: z
      .object({
        max_results: z.number().int().min(1).max(50).optional().describe("Max drafts to return"),
      })
      .passthrough(),
  },
  {
    slug: "GMAIL_GET_ATTACHMENT",
    description:
      "Download an attachment from a Gmail message by message ID and attachment ID. Returns the base64-encoded data. Read-only.",
    parameters: z
      .object({
        message_id: z.string().describe("The Gmail message ID"),
        attachment_id: z.string().describe("The attachment ID"),
        file_name: z.string().describe("Filename to save the downloaded attachment as"),
      })
      .passthrough(),
  },

  // ── Write/send actions (gated) ─────────────────────────────────
  {
    slug: "GMAIL_SEND_EMAIL",
    description:
      "Send a new email via Gmail. Supports one primary recipient plus cc/bcc. Requires user approval before it runs.",
    parameters: z
      .object({
        recipient_email: z.string().describe("Primary recipient's email address"),
        subject: z.string().describe("Email subject line"),
        body: z.string().describe("Email body (plain text)"),
        cc: z.array(z.string()).optional().describe("CC recipients"),
        bcc: z.array(z.string()).optional().describe("BCC recipients"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Send email to ${String(a["recipient_email"] ?? "")}`,
      preview: `To: ${String(a["recipient_email"] ?? "")}\nSubject: ${String(a["subject"] ?? "")}\n\n${String(a["body"] ?? "").slice(0, 500)}`,
      confirmText: "Send email",
    }),
  },
  {
    slug: "GMAIL_REPLY_TO_THREAD",
    description:
      "Reply to an email in its existing thread. Requires the thread ID (not the message ID) and the recipient's address. Requires user approval before it runs.",
    parameters: z
      .object({
        thread_id: z.string().describe("Gmail thread ID to reply within"),
        recipient_email: z.string().describe("Recipient's email address"),
        message_body: z.string().describe("Reply body (plain text)"),
        cc: z.array(z.string()).optional().describe("Additional CC recipients"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Reply in thread ${String(a["thread_id"] ?? "").slice(0, 12)}`,
      preview: String(a["message_body"] ?? "").slice(0, 500),
      confirmText: "Send reply",
    }),
  },
  {
    slug: "GMAIL_ADD_LABEL_TO_EMAIL",
    description:
      "Add or remove labels on a Gmail message — the mechanism behind marking read/unread (UNREAD label), archiving (remove INBOX), and starring (STARRED). Requires user approval before it runs.",
    parameters: z
      .object({
        message_id: z.string().describe("The Gmail message ID to modify"),
        add_label_ids: z
          .array(z.string())
          .optional()
          .describe("Label IDs to add, e.g. STARRED, IMPORTANT"),
        remove_label_ids: z
          .array(z.string())
          .optional()
          .describe("Label IDs to remove, e.g. UNREAD (marks as read), INBOX (archives)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Modify Gmail labels",
      preview: [
        `Message: ${String(a["message_id"] ?? "").slice(0, 12)}`,
        (a["add_label_ids"] as string[])?.length
          ? `Add labels: ${(a["add_label_ids"] as string[]).join(", ")}`
          : null,
        (a["remove_label_ids"] as string[])?.length
          ? `Remove labels: ${(a["remove_label_ids"] as string[]).join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
      confirmText: "Modify labels",
    }),
  },
  {
    slug: "GMAIL_MOVE_TO_TRASH",
    description: "Move a Gmail message to the trash. Requires user approval before it runs.",
    parameters: z
      .object({
        message_id: z.string().describe("The Gmail message ID to trash"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Trash email",
      preview: `Move message ${String(a["message_id"] ?? "").slice(0, 12)} to trash`,
      confirmText: "Move to trash",
    }),
  },
  {
    slug: "GMAIL_CREATE_LABEL",
    description: "Create a new Gmail label. Requires user approval before it runs.",
    parameters: z
      .object({
        label_name: z.string().describe("Name of the new label"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create Gmail label: ${String(a["label_name"] ?? "")}`,
      preview: `Create label "${String(a["label_name"] ?? "")}"`,
      confirmText: "Create label",
    }),
  },
  {
    slug: "GMAIL_CREATE_EMAIL_DRAFT",
    description:
      "Create a draft email in Gmail without sending. Supports one primary recipient plus cc/bcc. Requires user approval before it runs.",
    parameters: z
      .object({
        recipient_email: z.string().describe("Primary recipient's email address"),
        subject: z.string().describe("Email subject line"),
        body: z.string().describe("Plain-text email body"),
        cc: z.array(z.string()).optional().describe("CC recipients"),
        bcc: z.array(z.string()).optional().describe("BCC recipients"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create email draft",
      preview: `To: ${String(a["recipient_email"] ?? "")}\nSubject: ${String(a["subject"] ?? "")}\n\n${String(a["body"] ?? "").slice(0, 500)}`,
      confirmText: "Create draft",
    }),
  },
  {
    slug: "GMAIL_SEND_DRAFT",
    description:
      "Send an existing Gmail draft by its draft ID. Requires user approval before it runs.",
    parameters: z
      .object({
        draft_id: z.string().describe("The draft ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Send email draft",
      preview: `Send draft ${String(a["draft_id"] ?? "").slice(0, 12)}`,
      confirmText: "Send draft",
    }),
  },

  // ── Irreversible actions ──────────────────────────────────────
  {
    slug: "GMAIL_DELETE_MESSAGE",
    description:
      "Permanently delete a Gmail message (not just trash — actual deletion). This CANNOT be undone. Requires user approval before it runs.",
    parameters: z
      .object({
        message_id: z.string().describe("The Gmail message ID to permanently delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Permanently delete email",
      preview: `Permanently delete message ${String(a["message_id"] ?? "").slice(0, 12)}. This CANNOT be undone.`,
      confirmText: "Delete permanently",
    }),
  },
]

export function makeComposioGmailDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google",
    name: "Google Gmail",
    category: "email",
    icon: "gmail",
    description: "Read, search, and send emails from your Gmail account (via Composio).",
    readOnlyByDefault: false,
    auth: {
      kind: "composio",
      toolkit: GMAIL_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_GMAIL_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Configure a custom Google OAuth app in Composio using your existing Google Cloud project credentials",
        "Set COMPOSIO_API_KEY and COMPOSIO_GMAIL_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=google to route Gmail through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_GMAIL_AUTH_CONFIG_ID",
          label: "Composio Gmail auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/gmail",
    },
    tools: createComposioTools({
      provider: "google",
      toolkit: GMAIL_TOOLKIT,
      specs: gmailComposioSpecs,
      executor,
    }),
  }
}
