# Google Drive Connector

Runtime definition: `packages/agent-core/src/connectors/google-drive-def.ts`

Runtime id: `google-drive`

Auth: OAuth 2.0 with `https://www.googleapis.com/auth/drive` and
`userinfo.email`.

## Tools

| Tool                    | Type               | Purpose                                                                          |
| ----------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `drive-getStorageQuota` | Read               | Report Drive usage, limit, free space, and percentage used.                      |
| `drive-searchFiles`     | Read               | Search files with Drive query syntax.                                            |
| `drive-listFiles`       | Read               | List recent files globally or in a folder.                                       |
| `drive-getFile`         | Read               | Get metadata for one file.                                                       |
| `drive-readFile`        | Read               | Export/read text from Docs, Sheets, Slides, text, CSV, JSON, and markdown files. |
| `drive-listPermissions` | Read               | List permissions on a file.                                                      |
| `drive-createFile`      | Write              | Create a Google Doc, Sheet, Slides, Drawing, Apps Script, Form, Site, or Jamboard via `kind` param. |
| `drive-createFolder`    | Write              | Create a folder with optional parent.                                            |
| `drive-updateFile`      | Write              | Rename and/or move a file.                                                       |
| `drive-deleteFile`      | Write/Irreversible | Trash or permanently delete a file.                                              |
| `drive-shareFile`       | Write              | Share with user/group or create a shareable link.                                |
| `drive-copyFile`        | Write              | Copy a file.                                                                     |
| `drive-convertFile`     | Write              | Convert a Google Doc to PDF or other format.                                     |

## Notes

Binary files return metadata and links instead of content. Permanent deletion
must be treated as irreversible and explicitly confirmed. All write operations
use `gateWrite`.
