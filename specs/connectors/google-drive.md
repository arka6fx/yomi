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
| `drive-createFile`      | Write              | Create a Google Doc with text content.                                           |
| `drive-updateFile`      | Write              | Rename and/or move a file.                                                       |
| `drive-deleteFile`      | Write/Irreversible | Trash or permanently delete a file.                                              |

## Notes

Binary files return metadata and links instead of content. Permanent deletion
must be treated as irreversible and explicitly confirmed.
