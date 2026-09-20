# Google Gmail Connector

Runtime definition: Python port in progress (`apps/backend/src/yomi/connectors/`)

Runtime id: `google`

Auth: OAuth 2.0 with `gmail.modify`, `gmail.send`, and `userinfo.email`.
Permanent deletion is intentionally not offered, so the full
`https://mail.google.com/` scope is not requested.

## Tools

| Tool                          | Type  | Purpose                                         |
| ----------------------------- | ----- | ----------------------------------------------- |
| `gmail-searchEmails`          | Read  | Search Gmail with Gmail query operators.        |
| `gmail-readEmail`             | Read  | Read a message body and metadata by message ID. |
| `gmail-getUnreadEmails`       | Read  | List recent unread inbox messages.              |
| `gmail-getImportantEmails`    | Read  | List important inbox messages, unread first.    |
| `gmail-summarizeEmails`       | Read  | Fetch raw email content for summarization.      |
| `gmail-getThread`             | Read  | Read all messages in a thread.                  |
| `gmail-listLabels`            | Read  | List user labels and system labels.             |
| `gmail-getAttachment`         | Read  | Get an attachment by message and attachment ID. |
| `gmail-listDrafts`            | Read  | List drafts.                                    |
| `gmail-sendEmail`             | Send  | Send a new plain-text email.                    |
| `gmail-replyToThread`         | Send  | Reply in-thread with proper threading headers.  |
| `gmail-sendDraft`             | Send  | Send a saved draft.                             |
| `gmail-createDraft`           | Write | Create a draft with recipients, subject, body.  |
| `gmail-markAsRead`            | Write | Remove the unread label.                        |
| `gmail-markAsUnread`          | Write | Add the unread label.                           |
| `gmail-archiveEmail`          | Write | Remove the inbox label.                         |
| `gmail-trashEmail`            | Write | Move a message to Trash.                        |
| `gmail-applyLabels`           | Write | Add/remove labels on a message.                 |
| `gmail-createLabel`           | Write | Create a new label.                             |
| `gmail-saveAttachmentToDrive` | Write | Save an attachment straight into Google Drive.  |

## Notes

Sending and destructive operations use `gateWrite` and are gated through pending
actions when the runtime provides `createPendingAction`.
`gmail-saveAttachmentToDrive` is a cross-connector tool: it reads via the Gmail
token and uploads via the Google Drive token, so it needs both connected.
