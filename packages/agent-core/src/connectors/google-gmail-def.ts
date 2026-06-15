import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError } from "./connector-def.js"
import { GoogleGmailConnector } from "./google-gmail.js"

function notConnectedError(): { error: string; hint: string } {
  return {
    error: "Gmail is not connected",
    hint: "Ask the user to connect Gmail via the Integrations tab.",
  }
}

function formatEmail(e: {
  id: string
  subject: string
  from: string
  date: string
  snippet: string
  isRead: boolean
}): string {
  const status = e.isRead ? "" : " [UNREAD]"
  return `ID: ${e.id}${status}\nFrom: ${e.from}\nDate: ${e.date}\nSubject: ${e.subject}\nPreview: ${e.snippet}`
}

export function createGmailTools(ctx: ConnectorContext): ToolSet {
  const gmail = new GoogleGmailConnector(ctx.userId, ctx.getAccessToken)

  return {
    "gmail-searchEmails": tool({
      description:
        "Search Gmail for emails matching a query string (supports Gmail search operators like from:, subject:, after:, before:, has:attachment). Returns matching emails with ID, sender, subject, date, and snippet.",
      parameters: z.object({
        query: z.string().describe("Gmail search query, e.g. 'from:boss@example.com is:unread'"),
        limit: z.number().int().min(1).max(20).default(10).describe("Max results to return"),
      }),
      execute: async ({ query, limit }) => {
        if (!gmail.isConnected()) return notConnectedError()
        try {
          const emails = await gmail.searchEmails(query, limit)
          if (emails.length === 0) return { results: [], message: "No emails found." }
          return { results: emails, formatted: emails.map(formatEmail).join("\n\n") }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "gmail-readEmail": tool({
      description:
        "Read the full content of a single Gmail message by its ID. Returns the full body, headers (from, to, cc), and metadata.",
      parameters: z.object({
        messageId: z.string().describe("The Gmail message ID from a search or list result"),
      }),
      execute: async ({ messageId }) => {
        if (!gmail.isConnected()) return notConnectedError()
        try {
          const email = await gmail.readEmail(messageId)
          return {
            id: email.id,
            subject: email.subject,
            from: email.from,
            to: email.to,
            cc: email.cc,
            date: email.date,
            body: email.body.slice(0, 8000),
            isRead: email.isRead,
            labels: email.labels,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "gmail-getUnreadEmails": tool({
      description:
        "Get the most recent unread emails from the Gmail inbox. Returns email summaries with IDs, senders, subjects, and snippets.",
      parameters: z.object({
        limit: z.number().int().min(1).max(20).default(10).describe("Max unread emails to return"),
      }),
      execute: async ({ limit }) => {
        if (!gmail.isConnected()) return notConnectedError()
        try {
          const emails = await gmail.getUnreadEmails(limit)
          if (emails.length === 0) return { emails: [], message: "Inbox is clear — no unread emails." }
          return { count: emails.length, emails, formatted: emails.map(formatEmail).join("\n\n") }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "gmail-summarizeEmails": tool({
      description:
        "Fetch and return the raw content of emails to summarize. Pass specific message IDs, or leave empty to summarize the last 5 unread emails. Use the returned content to write a human-friendly summary.",
      parameters: z.object({
        messageIds: z
          .array(z.string())
          .optional()
          .describe("Specific message IDs to summarize. Omit to use last 5 unread."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe("Number of unread emails to summarize when no IDs provided"),
      }),
      execute: async ({ messageIds, limit }) => {
        if (!gmail.isConnected()) return notConnectedError()
        try {
          let ids = messageIds
          if (!ids || ids.length === 0) {
            const unread = await gmail.getUnreadEmails(limit)
            ids = unread.map((e) => e.id)
          }
          if (ids.length === 0) return { emails: [], message: "No emails to summarize." }
          const emails = await gmail.summarizeEmailsRaw(ids)
          return {
            emails: emails.map((e) => ({
              id: e.id,
              subject: e.subject,
              from: e.from,
              date: e.date,
              body: e.body.slice(0, 3000),
            })),
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "gmail-sendEmail": tool({
      description:
        "Send an email via Gmail. IMPORTANT: Always show the user a confirmation before calling this tool — display the To, Subject, and first 200 chars of body and ask them to confirm. Use act_proposed if available.",
      parameters: z.object({
        to: z.array(z.string()).describe("Recipient email addresses"),
        subject: z.string().describe("Email subject line"),
        body: z.string().describe("Plain-text email body"),
        cc: z.array(z.string()).optional().describe("CC recipients"),
        bcc: z.array(z.string()).optional().describe("BCC recipients"),
        replyToMessageId: z
          .string()
          .optional()
          .describe("Gmail message ID to reply to (for threading)"),
      }),
      execute: async ({ to, subject, body, cc, bcc, replyToMessageId }) => {
        if (!gmail.isConnected()) return notConnectedError()
        try {
          const result = await gmail.sendEmail({ to, subject, body, cc, bcc, replyToMessageId })
          return {
            ok: true,
            messageId: result.messageId,
            threadId: result.threadId,
            message: `Email sent to ${to.join(", ")} with subject "${subject}".`,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "gmail-markAsRead": tool({
      description: "Mark a Gmail message as read (removes the UNREAD label).",
      parameters: z.object({
        messageId: z.string().describe("The Gmail message ID to mark as read"),
      }),
      execute: async ({ messageId }) => {
        if (!gmail.isConnected()) return notConnectedError()
        try {
          await gmail.markAsRead(messageId)
          return { ok: true, message: `Message ${messageId} marked as read.` }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "gmail-markAsUnread": tool({
      description: "Mark a Gmail message as unread (adds the UNREAD label).",
      parameters: z.object({
        messageId: z.string().describe("The Gmail message ID to mark as unread"),
      }),
      execute: async ({ messageId }) => {
        if (!gmail.isConnected()) return notConnectedError()
        try {
          await gmail.markAsUnread(messageId)
          return { ok: true, message: `Message ${messageId} marked as unread.` }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "gmail-archiveEmail": tool({
      description:
        "Archive a Gmail message by removing it from the inbox (removes the INBOX label). IMPORTANT: Confirm with the user before archiving.",
      parameters: z.object({
        messageId: z.string().describe("The Gmail message ID to archive"),
      }),
      execute: async ({ messageId }) => {
        if (!gmail.isConnected()) return notConnectedError()
        try {
          await gmail.archiveEmail(messageId)
          return { ok: true, message: `Message ${messageId} archived.` }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "gmail-trashEmail": tool({
      description:
        "Move a Gmail message to the trash. IMPORTANT: Always confirm with the user before calling this tool.",
      parameters: z.object({
        messageId: z.string().describe("The Gmail message ID to move to trash"),
      }),
      execute: async ({ messageId }) => {
        if (!gmail.isConnected()) return notConnectedError()
        try {
          await gmail.trashEmail(messageId)
          return { ok: true, message: `Message ${messageId} moved to trash.` }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "gmail-getThread": tool({
      description:
        "Fetch all messages in a Gmail thread by threadId. Returns messages in order, each with full body and headers.",
      parameters: z.object({
        threadId: z.string().describe("The Gmail thread ID (returned by search or read operations)"),
      }),
      execute: async ({ threadId }) => {
        if (!gmail.isConnected()) return notConnectedError()
        try {
          const thread = await gmail.getThread(threadId)
          return {
            threadId: thread.id,
            messageCount: thread.messages.length,
            messages: thread.messages.map((m) => ({
              id: m.id,
              subject: m.subject,
              from: m.from,
              to: m.to,
              date: m.date,
              body: m.body.slice(0, 4000),
              isRead: m.isRead,
              labels: m.labels,
            })),
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),
  }
}

export const googleGmailDef: ConnectorDef = {
  id: "google",  // matches provider key in mcp_connections for existing connections
  name: "Google Gmail",
  category: "email",
  icon: "gmail",
  description: "Read, search, and send emails from your Gmail account.",
  readOnlyByDefault: false,
  auth: {
    kind: "oauth2",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    clientIdEnv: "GOOGLE_INTEGRATIONS_CLIENT_ID",
    clientSecretEnv: "GOOGLE_INTEGRATIONS_CLIENT_SECRET",
    redirectPath: "/api/integrations/callback/google",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  setup: {
    providerConsoleUrl: "https://console.cloud.google.com/apis/credentials",
    steps: [
      "Go to Google Cloud Console → APIs & Services → Credentials",
      "Create an OAuth 2.0 Client ID (Web application type)",
      "Add Authorized Redirect URI: ${BACKEND_URL}/api/integrations/callback/google",
      "Enable Gmail API under APIs & Services → Library",
      "Copy the Client ID and Client Secret below",
    ],
    collect: [
      { env: "GOOGLE_INTEGRATIONS_CLIENT_ID", label: "Google Client ID", secret: false },
      { env: "GOOGLE_INTEGRATIONS_CLIENT_SECRET", label: "Google Client Secret", secret: true },
    ],
    docsUrl: "https://developers.google.com/gmail/api/quickstart",
  },
  tools: createGmailTools,
}
