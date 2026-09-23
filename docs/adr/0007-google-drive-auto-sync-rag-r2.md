# Google Drive auto-syncs into RAG via composio tools and R2-staged content

Status: accepted

## Decision

A Google Drive folder becomes a **RAG source** that keeps itself in sync. The
sync is driven by Composio googledrive tools and the source's content is staged
through Cloudflare R2 so the container never touches Amazon S3.

- **Automatic, folder-scoped, index-only.** One `rag_sources` row per
  `(userId, folderId)` (`sourceType = 'google-drive'`, privacy scope
  `cloud_rag`). v1 depth only: direct children, no recursion. Deleting the
  source deletes its documents and chunks. It is a read/index surface, not a
  write path.
- **Composio is the Drive client.** `build_drive_session` reuses the same
  Composio connection the agent's `googledrive` toolkit uses, so a user who
  connects Drive in the dashboard gets syncing for free — no second OAuth flow,
  no token storage of our own. Tool slugs (probed live): `GOOGLEDRIVE_LIST_FILES`,
  `GOOGLEDRIVE_GET_CHANGES_START_PAGE_TOKEN`, `GOOGLEDRIVE_LIST_CHANGES`,
  `GOOGLEDRIVE_PARSE_FILE`.
- **Content is staged through R2, never S3.** `GOOGLEDRIVE_PARSE_FILE` returns a
  presigned S3 URL, but the container never pulls it directly. The storage
  Worker (`ingest/put`) fetches those bytes into a short-lived R2 object
  (max 8 MB, 24 h TTL, `ingest/<prefix>/<uuid>` keys); the container reads them
  back (`ingest/read`), then deletes them (`ingest/delete`). A `prefix` derived
  from the user id keeps GC scoped.
- **Two-phase population.** _Backfill_ lists the folder statically (paged, 20
  files per tick, max 1000 children) until drained, then marks the source
  `active`. _Incremental sync_ then uses the Drive Changes API: it persists the
  `startPageToken` from `GET_CHANGES_START_PAGE_TOKEN` and applies
  `LIST_CHANGES` pages, deleting docs that were trashed or moved outside the
  folder. Sync is refused (`409 backfill_pending`) until the source is `active`.
- **Only text-exportable files are indexed.** Google Docs and Slides export to
  `text/plain`, Sheets to `text/csv`; native `txt`/`md`/`csv`/`tsv`/`html`/
  `xml`/`json` pass through as `text/plain`. Everything else (notably PDFs and
  images) is counted as skipped, never fatal. A single bad file is swallowed and
  counted; it must not sink a tick.
- **Sync state lives in `rag_sources.sync_state`.** A versioned JSON blob
  (`{version: 1, startPageToken, pending, pendingIndex, filesSkipped,
  filesIndexed, lastSync}`) so a deploy or restart resumes the same page-token
  walk. The column is `TEXT`; D1's prepared-statement layer rejects non-scalar
  params, so the blob is `json.dumps`'d by `update_source_state`.
- **Surface.** User endpoints `POST /api/rag/drive/sources`, `/backfill`,
  `/sync`; the sweeping cron hits `POST /internal/rag/drive-sync` (5 sources
  per turn) so a source is caught up even when the user never calls sync.
- **Warm-cache quirk is designed in.** `GOOGLEDRIVE_PARSE_FILE` only resolves
  file ids that were listed earlier in the same Composio session, so both
  ticks list before they parse: backfill re-lists during the walk, incremental
  sync warms the folder once per tick.

## Why

- **No S3.** The stack is a $5 Cloudflare Workers plan with no AWS identity;
  cloudflare is the object store of record. The storage Worker already fronts
  D1 and Vectorize for this container, so R2 binds into the same Worker and the
  gateway contract (`ingest/put|read|delete` behind the shared gateway secret)
  extends without a new service. Direct S3 client code was rejected outright.
- **Changes API over re-listing.** A folder-scoped incremental walk that
  re-lists does not fault-tolerantly survive a removed file (a deleted child
  simply isn't there to see). Paging the token answers "what changed since
  last sync" explicitly and cheaply; the membership filter (external ids that
  are still a known child or in the folder) keeps its semantics honest.
- **Composio over a hand-rolled refresh loop** matches the connector policy:
  Composio owns token lifecycle and connection state mirrored into
  `composio_connections`, and the connection already exists for the agent
  toolkit. A second OAuth path would double the consent surface for the same
  read scope.
- **Index by folder, not by file.** The unit of a RAG source is the folder,
  which a user can name and re-point; the identity is the immutable folder id,
  not a path. v1 keeps depth out so the semantics are provably right before
  recursion is added.

## Consequences

- **PDFs and other binaries are silently skipped.** This is the biggest
  expectation gap and the cheapest future win (a converter/OCR path would
  slot into `fetch_text`); skip counts are tracked in sync state so the gap is
  visible to ops even when silent to users.
- **R2 temp objects are ephemeral by contract.** A 24 h TTL plus opportunistic
  GC on every put bounds leakage; a fetch that succeeds but crashes before
  delete leaves an object that self-expires. Object storage is cheap enough
  that the simpler lifecycle won the day.
- **Silent per-file failures need a backstop.** The API sees `filesSkipped`
  counts, not per-file errors; diagnosing a flaky export needs the ops sweep's
  per-source attempts or the composio action logs.
- **Indexing is async by design.** Backfill/sync only write `rag_documents`
  outbox rows; the embedding sweep must run before Drive content is actually
  retrievable, so freshness of answers trails the sync by one pipeline hop.
- **Reversing is cheap now, costlier later.** Today removing a source is a
  delete; once users accumulate folders with years of indexed content, the
  forward path (page token ahead of the current listing) is the one that's
  hard to unwind — a backwards jump means a full re-backfill. Keep
  `_SYNC_STATE_VERSION = 1` semantics stable, or version-bump instead of
  patching.