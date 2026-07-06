# Google Gmail Connector

Runtime definition: `packages/agent-core/src/connectors/google-gmail-def.ts`

Runtime id: `google`

Auth: OAuth 2.0 with full Gmail scope `https://mail.google.com/` and
`userinfo.email`.

## Tools

| Tool                      | Type         | Purpose                                         |
| ------------------------- | ------------ | ----------------------------------------------- |
| `gmail-searchEmails`      | Read         | Search Gmail with Gmail query operators.        |
| `gmail-readEmail`         | Read         | Read a message body and metadata by message ID. |
| `gmail-getUnreadEmails`   | Read         | List recent unread inbox messages.              |
| `gmail-summarizeEmails`   | Read         | Fetch raw email content for summarization.      |
| `gmail-getThread`         | Read         | Read all messages in a thread.                  |
| `gmail-listLabels`        | Read         | List user labels and system labels.             |
| `gmail-getAttachment`     | Read         | Get an attachment by message and attachment ID. |
| `gmail-listDrafts`        | Read         | List drafts.                                    |
| `gmail-sendEmail`         | Send         | Send a plain-text email or threaded reply.      |
| `gmail-sendDraft`         | Send         | Send a saved draft.                             |
| `gmail-createDraft`       | Write        | Create a draft with recipients, subject, body.  |
| `gmail-markAsRead`        | Write        | Remove the unread label.                        |
| `gmail-markAsUnread`      | Write        | Add the unread label.                           |
| `gmail-archiveEmail`      | Write        | Remove the inbox label.                         |
| `gmail-trashEmail`        | Write        | Move a message to Trash.                        |
| `gmail-deletePermanently` | Irreversible | Permanently delete a message.                   |
| `gmail-applyLabels`       | Write        | Add/remove labels on a message.                 |
| `gmail-createLabel`       | Write        | Create a new label.                             |

## Notes

Sending and destructive operations use `gateWrite` and are gated through pending
actions when the runtime provides `createPendingAction`. Irreversible tools
require explicit user confirmation before execution.
