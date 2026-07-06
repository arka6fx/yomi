# Google Drive → RAG Auto-Sync — Design

Date: 2026-07-06
Status: Approved (design); pending implementation plan

## Summary

Continuously index user-selected Google Drive folders into Yomi's existing RAG
store so the agent can semantically search the user's own documents. The
retrieval half (chunking, embeddings, hybrid RRF + MMR + LLM rerank) already
exists in `apps/backend/src/routes/rag.ts`; this feature builds the **ingestion
half** — fetching Drive content, extracting text, and keeping the index fresh —
entirely in the backend so it works even when the desktop app is closed.

## Scope (v1)

- **Connector:** Google Drive only.
- **Selection:** user-picked folders (not the whole Drive).
- **Freshness:** scheduled incremental sync via the Drive Changes API, driven by
  a Cloudflare Cron Trigger.
- **File types:** Google-native (Docs → text, Sheets → CSV, Slides → text) plus
  plain text (`txt`, `md`, `csv`, `json`). PDFs and Office files are **skipped**
  with a visible "unsupported" note and counted in `filesSkipped`.
- **Folder recursion:** direct children only. Recursive descent into subfolders
  is a v2 knob.
- **Pipeline placement:** backend-owned (Approach A). The backend uses its
  existing `ConnectorRegistry` (the same one that serves Telegram) to call the
  Drive API directly. The desktop only calls source-CRUD routes to let the user
  pick folders.

Out of scope for v1: Gmail/Notion sources, PDF/OCR/Office extraction, recursive
subfolders, real-time webhooks, credit charging for sync.

## Non-goals

- No changes to retrieval ranking. Drive chunks flow through the existing
  `/rag/search` path unchanged (beyond carrying a Drive link for citations).
- No second indexing engine — Drive sync and the manual push routes share one
  `index-document` path.

## Architecture

Backend-owned pipeline. Module boundaries (each independently testable):

| Module | Responsibility | Interface |
| --- | --- | --- |
| `services/rag/drive-extract.ts` | Pure text-extraction routing by mimeType | `(fileMeta, fetchFn) → { text } \| { skipped, reason }` |
| `services/rag/index-document.ts` | Chunk → embed → upsert; dedup by content hash | `(source, externalId, title, text) → documentId` |
| `services/rag/drive-sync.ts` | Orchestrator: backfill + incremental sync | `(source) → syncResult` |
| `routes/rag-drive.ts` | Thin HTTP over source CRUD + manual trigger | REST |
| scheduled handler | Cron tick → sync all due sources | Cloudflare `scheduled` event |

**Refactor:** the chunk/embed/store logic currently inline in `routes/rag.ts` is
extracted into `index-document.ts` so both the manual push routes and Drive sync
use one path. `drive-extract.ts` lifts the `EXPORT_MIME` map already present in
`drive-readFile` (`google-drive-def.ts`).

## Data model

One migration. Reuses `rag_sources / rag_documents / rag_chunks /
rag_embeddings`.

1. `rag_sources`: add `sync_state jsonb`. Holds
   `{ folderId, drivePageToken, backfillCursor, lastSyncedAt, filesIndexed, filesSkipped }`.
   A Drive source uses `sourceType = "google-drive"`, `path = folderId`.
2. `rag_documents`: add `external_id text` (the Drive fileId) and an index on
   `(source_id, external_id)`. This maps a changed/deleted Drive file back to its
   document. The existing `metadata` jsonb carries `{ mimeType, webViewLink }`
   for citations.
3. `rag_chunks` / `rag_embeddings`: unchanged — they cascade from documents and
   flow through retrieval as-is.

**Source status lifecycle:** `backfilling → active`, with `needs_reconnect`
(auth failed) and `paused` as side states.

## Sync lifecycle

### Folder selection → source creation
The desktop Integrations UI lets the user pick one or more Drive folders (listed
via existing Drive tools). `POST /rag/drive/sources { folderId, name }` creates a
`rag_sources` row with status `backfilling` and **immediately captures the Drive
`startPageToken`** into `sync_state` *before* backfilling, so edits made during
the backfill are not missed.

### Initial backfill (batched)
A Worker invocation cannot index a large folder in one shot, so backfill runs in
bounded batches. Each tick: `files.list` under the folder (paged) → process ~20
files → advance `backfillCursor` → repeat until exhausted → set status `active`.
Each file: `drive-extract` → `index-document`. Dedup by `contentHash` makes
restarts idempotent.

### Incremental sync (cron, every N hours)
A Cloudflare Cron Trigger iterates `active` sources and calls
`changes.list(drivePageToken)`:
- **Changed file** within folder scope → re-extract + re-index (hash-dedup skips
  unchanged content).
- **Trashed/removed file** → delete its `rag_document` (chunks/embeddings
  cascade).
- Persist the new `pageToken`.

### Scope filtering
Drive's changes feed is Drive-wide, not folder-scoped. Each change is filtered:
if its `fileId` is already indexed (known `external_id`) → act; if it is a new
file, check that its `parents` include the indexed `folderId`. Direct children
only in v1.

## Error handling

- **Auth failure (401/403):** set source `needs_reconnect`, pause syncing,
  surface the existing reconnect hint (`connectorError` pattern). No silent
  failures.
- **Expired page token (410 Gone):** fall back to a fresh backfill and
  re-capture `startPageToken`.
- **Per-file failure:** log, increment `filesSkipped`, continue. One bad file
  never fails the whole tick.
- **Rate limits (Drive / OpenAI embeddings):** bounded batch sizes + backoff;
  incremental payloads are small by design.
- **Idempotency:** `contentHash` dedup means re-processing any file is safe.

## Privacy & consent

- `requireConsent("cloud_memory")` on all Drive-sync routes (matches existing
  RAG routes).
- `privacyScope` set on the source row.
- `privacy/deletion.ts` extended: deleting a source or disconnecting the Drive
  connector purges its documents/chunks/embeddings.

## Cost

Sync does **not** charge credits (matches the "connectors unlimited" principle).
The real cost is embedding spend; it is bounded by folder scope plus a per-source
file cap so a very large folder cannot run away. The cap is the guardrail.

## Surfaces (new / changed)

- 1 DB migration (2 columns + 1 index).
- `services/rag/drive-extract.ts` (new).
- `services/rag/index-document.ts` (new; refactored out of `routes/rag.ts`).
- `services/rag/drive-sync.ts` (new).
- `routes/rag-drive.ts` (new): `POST /rag/drive/sources`, `GET /rag/drive/sources`,
  `DELETE /rag/drive/sources/:id`, `POST /rag/drive/sources/:id/sync` (manual).
- Scheduled handler + `wrangler` cron trigger.
- Minimal desktop folder-picker in the Integrations UI.

## Testing

- **Unit** — `drive-extract` mimeType routing (each type → export / download /
  skip); scope filter (file in vs. out of folder); backfill cursor advances and
  terminates.
- **Integration** (mock Drive `files.list` / `export` / `changes.list`) —
  documents + chunks created; unchanged file dedups; trashed file deletes;
  401 → `needs_reconnect`; 410 → re-backfill. Reuses `rag.test.ts` patterns.

## Open questions / deferred

- Batch size (default ~20 files/tick) and cron interval (default every N hours)
  are tunable via env; final defaults set during implementation.
- Recursive subfolder indexing: v2.
- PDF / Office extraction: v2.
- Real-time webhooks (Drive push notifications): v2, if scheduled latency proves
  too slow.
