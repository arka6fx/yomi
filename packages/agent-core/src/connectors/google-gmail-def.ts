import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError, gateWrite } from "./connector-def.js"
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
        "Read the full content of a single Gmail message by its ID. Returns the full body, headers (from, to, cc), metadata, and an `attachments` list. Each attachment carries the attachmentId that gmail-saveAttachmentToDrive and gmail-getAttachment need — call this first when the user asks to save or open an attachment.",
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
            attachments: email.attachments,
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
          if (emails.length === 0)
            return { emails: [], message: "Inbox is clear — no unread emails." }
          return { count: emails.length, emails, formatted: emails.map(formatEmail).join("\n\n") }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "gmail-getImportantEmails": tool({
      description:
        "Get the most important recent emails in the Gmail inbox, ranked by Gmail's importance markers with unread ones first. Use this when the user asks what emails matter, what needs attention, or wants an inbox briefing.",
      parameters: z.object({
        limit: z.number().int().min(1).max(20).default(10).describe("Max emails to return"),
        unreadOnly: z.boolean().default(false).describe("Only include unread important emails"),
      }),
      execute: async ({ limit, unreadOnly }) => {
        if (!gmail.isConnected()) return notConnectedError()
        try {
          const query = unreadOnly ? "is:important is:unread in:inbox" : "is:important in:inbox"
          const emails = await gmail.searchEmails(query, limit)
          if (emails.length === 0)
            return { emails: [], message: "No important emails found in the inbox." }
          const ranked = [...emails].sort((a, b) => Number(a.isRead) - Number(b.isRead))
          return {
            count: ranked.length,
            emails: ranked,
            formatted: ranked.map(formatEmail).join("\n\n"),
          }
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
        "Send a NEW email via Gmail. To reply within an existing thread use gmail-replyToThread instead. If the user named the recipient by name rather than address ('email Alex'), ask the user for their email address first — never guess an address. IMPORTANT: confirm the To, Subject, and first 200 chars of body with the user before calling this tool.",
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
          if (ctx.createPendingAction) {
            const preview = [
              `To: ${to.join(", ")}`,
              cc?.length ? `Cc: ${cc.join(", ")}` : null,
              bcc?.length ? `Bcc: ${bcc.join(", ")}` : null,
              `Subject: ${subject}`,
              "",
              body.slice(0, 1200),
            ]
              .filter(Boolean)
              .join("\n")
            return await ctx.createPendingAction({
              connector: "google",
              action: "gmail.sendEmail",
              risk: "send",
              title: `Send email to ${to.join(", ")}`,
              preview,
              confirmText: "Send email",
              payload: { to, subject, body, cc, bcc, replyToMessageId },
            })
          }
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
      execute: async (args) => {
        const { messageId } = args
        if (!gmail.isConnected()) return notConnectedError()
        return gateWrite(
          ctx,
          {
            connector: "google",
            action: "gmail-markAsRead",
            risk: "write",
            title: `Mark email as read`,
            preview: `Mark message ${messageId} as read`,
            confirmText: "Mark as read",
          },
          args,
          async () => {
            try {
              await gmail.markAsRead(messageId)
              return { ok: true, message: `Message ${messageId} marked as read.` }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "gmail-markAsUnread": tool({
      description: "Mark a Gmail message as unread (adds the UNREAD label).",
      parameters: z.object({
        messageId: z.string().describe("The Gmail message ID to mark as unread"),
      }),
      execute: async (args) => {
        const { messageId } = args
        if (!gmail.isConnected()) return notConnectedError()
        return gateWrite(
          ctx,
          {
            connector: "google",
            action: "gmail-markAsUnread",
            risk: "write",
            title: `Mark email as unread`,
            preview: `Mark message ${messageId} as unread`,
            confirmText: "Mark as unread",
          },
          args,
          async () => {
            try {
              await gmail.markAsUnread(messageId)
              return { ok: true, message: `Message ${messageId} marked as unread.` }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "gmail-archiveEmail": tool({
      description:
        "Archive a Gmail message by removing it from the inbox (removes the INBOX label).",
      parameters: z.object({
        messageId: z.string().describe("The Gmail message ID to archive"),
      }),
      execute: async (args) => {
        const { messageId } = args
        if (!gmail.isConnected()) return notConnectedError()
        return gateWrite(
          ctx,
          {
            connector: "google",
            action: "gmail-archiveEmail",
            risk: "write",
            title: `Archive email`,
            preview: `Archive message ${messageId} (removes from inbox)`,
            confirmText: "Archive",
          },
          args,
          async () => {
            try {
              await gmail.archiveEmail(messageId)
              return { ok: true, message: `Message ${messageId} archived.` }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "gmail-trashEmail": tool({
      description: "Move a Gmail message to the trash.",
      parameters: z.object({
        messageId: z.string().describe("The Gmail message ID to move to trash"),
      }),
      execute: async (args) => {
        const { messageId } = args
        if (!gmail.isConnected()) return notConnectedError()
        return gateWrite(
          ctx,
          {
            connector: "google",
            action: "gmail-trashEmail",
            risk: "write",
            title: `Trash email`,
            preview: `Move message ${messageId} to trash`,
            confirmText: "Move to trash",
          },
          args,
          async () => {
            try {
              await gmail.trashEmail(messageId)
              return { ok: true, message: `Message ${messageId} moved to trash.` }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "gmail-replyToThread": tool({
      description:
        "Reply to an email inside its existing thread. Threading headers and the Re: subject are handled automatically — do NOT pass a subject. Pass the messageId of the message being replied to (usually the latest in the thread, from gmail-searchEmails, gmail-getThread, or gmail-readEmail). Confirm the reply body with the user before calling.",
      parameters: z.object({
        messageId: z.string().describe("Gmail message ID of the message to reply to"),
        body: z.string().describe("Plain-text reply body"),
        cc: z.array(z.string()).optional().describe("Additional CC recipients"),
        bcc: z.array(z.string()).optional().describe("BCC recipients"),
      }),
      execute: async (args) => {
        if (!gmail.isConnected()) return notConnectedError()
        // Best-effort sender/subject lookup so the approval preview is readable.
        let replyTarget = `message ${args.messageId}`
        try {
          const orig = await gmail.readEmail(args.messageId)
          replyTarget = `${orig.from} — "${orig.subject}"`
        } catch {
          // best-effort
        }
        return gateWrite(
          ctx,
          {
            connector: "google",
            action: "gmail-replyToThread",
            risk: "send",
            title: `Send reply to ${replyTarget}`,
            preview: `Reply to: ${replyTarget}\n\n${args.body.slice(0, 1200)}`,
            confirmText: "Send reply",
          },
          args,
          async () => {
            try {
              const result = await gmail.replyToThread(args)
              return {
                ok: true,
                messageId: result.messageId,
                threadId: result.threadId,
                message: `Reply sent to ${result.to} in thread "${result.subject}".`,
              }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "gmail-getThread": tool({
      description:
        "Fetch all messages in a Gmail thread by threadId. Returns messages in order, each with full body and headers.",
      parameters: z.object({
        threadId: z
          .string()
          .describe("The Gmail thread ID (returned by search or read operations)"),
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

    "gmail-listLabels": tool({
      description:
        "List all Gmail labels (both system and user-defined) with their ID, name, and type.",
      parameters: z.object({}),
      execute: async () => {
        if (!gmail.isConnected()) return notConnectedError()
        try {
          const labels = await gmail.listLabels()
          return {
            count: labels.length,
            labels: labels.map((l) => ({ id: l.id, name: l.name, type: l.type })),
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "gmail-applyLabels": tool({
      description:
        "Add or remove labels on a Gmail message — this is the tool that actually puts a message under a label. Get label IDs from gmail-listLabels; if the label does not exist yet, create it with gmail-createLabel first and pass the id it returns. Get the messageId from gmail-searchEmails or gmail-getImportantEmails.",
      parameters: z.object({
        messageId: z.string().describe("The Gmail message ID to modify"),
        addLabelIds: z.array(z.string()).optional().describe("Label IDs to add"),
        removeLabelIds: z.array(z.string()).optional().describe("Label IDs to remove"),
      }),
      execute: async (args) => {
        const { messageId, addLabelIds, removeLabelIds } = args
        if (!gmail.isConnected()) return notConnectedError()
        return gateWrite(
          ctx,
          {
            connector: "google",
            action: "gmail-applyLabels",
            risk: "write",
            title: `Apply labels to message`,
            preview: [
              `Message: ${messageId}`,
              addLabelIds?.length ? `Add labels: ${addLabelIds.join(", ")}` : null,
              removeLabelIds?.length ? `Remove labels: ${removeLabelIds.join(", ")}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
            confirmText: "Apply labels",
          },
          args,
          async () => {
            try {
              await gmail.applyLabels(messageId, addLabelIds ?? [], removeLabelIds ?? [])
              return { ok: true, message: `Labels updated on message ${messageId}.` }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "gmail-getAttachment": tool({
      description:
        "Download an attachment from a Gmail message by message ID and attachment ID. Returns the base64-encoded data, filename, and MIME type. First use gmail-readEmail to discover attachment IDs from the message body. To keep, share, or reuse the file, prefer gmail-saveAttachmentToDrive — it saves directly to Google Drive without downloading the data here.",
      parameters: z.object({
        messageId: z.string().describe("The Gmail message ID"),
        attachmentId: z.string().describe("The attachment ID (found in the message body parts)"),
      }),
      execute: async ({ messageId, attachmentId }) => {
        if (!gmail.isConnected()) return notConnectedError()
        try {
          const att = await gmail.getAttachment(messageId, attachmentId)
          return {
            filename: att.filename,
            mimeType: att.mimeType,
            size: att.size,
            data: att.data.slice(0, 500000),
            truncated: att.data.length > 500000,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "gmail-saveAttachmentToDrive": tool({
      description:
        "Save a Gmail attachment directly to the user's Google Drive and return the Drive file link — the file data never enters the conversation. Prefer this over gmail-getAttachment whenever the user wants to keep, organize, share, or reuse an attachment. Requires the Google Drive connector. Find messageId and attachmentId via gmail-readEmail.",
      parameters: z.object({
        messageId: z.string().describe("The Gmail message ID"),
        attachmentId: z.string().describe("The attachment ID from the message body parts"),
        name: z
          .string()
          .optional()
          .describe("File name in Drive (defaults to the attachment's own filename)"),
        folderId: z.string().optional().describe("Drive folder ID to save the file into"),
      }),
      execute: async (args) => {
        const { messageId, attachmentId, name, folderId } = args
        if (!gmail.isConnected()) return notConnectedError()
        return gateWrite(
          ctx,
          {
            connector: "google",
            action: "gmail-saveAttachmentToDrive",
            risk: "write",
            title: "Save Gmail attachment to Drive",
            preview: `Save attachment ${attachmentId} from message ${messageId} to Google Drive${name ? ` as "${name}"` : ""}${folderId ? ` in folder ${folderId}` : ""}`,
            confirmText: "Save to Drive",
          },
          args,
          async () => {
            let driveToken: string
            try {
              driveToken = await ctx.getAccessToken(ctx.userId, "google-drive")
            } catch {
              return {
                error: "Google Drive is not connected",
                hint: "Ask the user to connect Google Drive via the Integrations tab, then retry.",
              }
            }
            try {
              const att = await gmail.getAttachment(messageId, attachmentId)
              // Gmail returns base64url; Drive upload needs the raw bytes.
              const bytes = Buffer.from(att.data.replace(/-/g, "+").replace(/_/g, "/"), "base64")
              const metadata: Record<string, unknown> = {
                name: name ?? att.filename,
                ...(folderId ? { parents: [folderId] } : {}),
              }
              const boundary = "yomi_attachment_boundary"
              const encoder = new TextEncoder()
              const head = encoder.encode(
                `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${att.mimeType}\r\n\r\n`,
              )
              const tail = encoder.encode(`\r\n--${boundary}--`)
              const res = await fetch(
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,size",
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${driveToken}`,
                    "Content-Type": `multipart/related; boundary=${boundary}`,
                  },
                  body: new Blob([head, new Uint8Array(bytes), tail]),
                },
              )
              if (!res.ok)
                throw new Error(`Drive upload failed: ${res.status}: ${await res.text()}`)
              const file = (await res.json()) as {
                id: string
                name: string
                webViewLink?: string
                size?: string
              }
              return {
                ok: true,
                id: file.id,
                name: file.name,
                link: file.webViewLink,
                message: `Attachment saved to Drive as "${file.name}".`,
              }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "gmail-listDrafts": tool({
      description:
        "List all email drafts in Gmail. Returns draft IDs with subject, sender, and date.",
      parameters: z.object({}),
      execute: async () => {
        if (!gmail.isConnected()) return notConnectedError()
        try {
          const drafts = await gmail.listDrafts()
          if (drafts.length === 0) return { drafts: [], message: "No drafts found." }
          return { count: drafts.length, drafts }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "gmail-sendDraft": tool({
      description:
        "Send an existing Gmail draft by its draft ID. Use gmail-listDrafts first to find available drafts, then confirm with the user before sending.",
      parameters: z.object({
        draftId: z.string().describe("The draft ID from gmail-listDrafts"),
      }),
      execute: async (args) => {
        const { draftId } = args
        if (!gmail.isConnected()) return notConnectedError()
        return gateWrite(
          ctx,
          {
            connector: "google",
            action: "gmail-sendDraft",
            risk: "send",
            title: "Send email draft",
            preview: `Send draft ${draftId}`,
            confirmText: "Send draft",
          },
          args,
          async () => {
            try {
              const result = await gmail.sendDraft(draftId)
              return {
                ok: true,
                messageId: result.messageId,
                threadId: result.threadId,
                message: "Draft sent.",
              }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "gmail-createLabel": tool({
      description:
        "Create a new Gmail label and return its id. The label appears in the sidebar but starts EMPTY — creating it does not put any message in it. " +
        "When the user asked to label a message (e.g. 'label the invoice as Finance'), this is only step one: check gmail-listLabels first, create the label here only if it does not already exist, then call gmail-applyLabels with the returned id to actually label the message. Creating the label alone does not complete that request.",
      parameters: z.object({
        name: z.string().describe("Name of the new label"),
      }),
      execute: async (args) => {
        const { name } = args
        if (!gmail.isConnected()) return notConnectedError()
        return gateWrite(
          ctx,
          {
            connector: "google",
            action: "gmail-createLabel",
            risk: "write",
            title: `Create Gmail label: ${name}`,
            preview: `Create label "${name}"`,
            confirmText: "Create label",
          },
          args,
          async () => {
            try {
              const result = await gmail.createLabel(name)
              return { ok: true, id: result.id, name: result.name }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "gmail-createDraft": tool({
      description:
        "Create a draft email in Gmail without sending. Use this to prepare an email for user review before sending.",
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
      execute: async (args) => {
        const { to, subject, body, cc, bcc, replyToMessageId } = args
        if (!gmail.isConnected()) return notConnectedError()
        return gateWrite(
          ctx,
          {
            connector: "google",
            action: "gmail-createDraft",
            risk: "write",
            title: `Create email draft`,
            preview: [
              `To: ${to.join(", ")}`,
              cc?.length ? `Cc: ${cc.join(", ")}` : null,
              bcc?.length ? `Bcc: ${bcc.join(", ")}` : null,
              `Subject: ${subject}`,
              "",
              body.slice(0, 800),
            ]
              .filter(Boolean)
              .join("\n"),
            confirmText: "Create draft",
          },
          args,
          async () => {
            try {
              const result = await gmail.createDraft({
                to,
                subject,
                body,
                cc,
                bcc,
                replyToMessageId,
              })
              return { ok: true, draftId: result.id, messageId: result.messageId }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),
  }
}

export const googleGmailDef: ConnectorDef = {
  id: "google", // matches provider key in mcp_connections for existing connections
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
      // gmail.modify covers all read/write ops except permanent deletion
      // (which we intentionally don't offer). Still "restricted" — requires
      // Google CASA verification for public release, or test-user allowlisting
      // — but avoids the full-mailbox mail.google.com scope.
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
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
