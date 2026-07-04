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
| `gmail-sendEmail`         | Send         | Send a plain-text email or threaded reply.      |
| `gmail-markAsRead`        | Write        | Remove the unread label.                        |
| `gmail-markAsUnread`      | Write        | Add the unread label.                           |
| `gmail-archiveEmail`      | Write        | Remove the inbox label.                         |
| `gmail-trashEmail`        | Write        | Move a message to Trash.                        |
| `gmail-deletePermanently` | Irreversible | Permanently delete a message.                   |

## Notes

Sending is gated through pending actions when the runtime provides
`createPendingAction`. Destructive tools should require explicit user
confirmation before execution.
