# Spec 16 - RAG

Backend-owned retrieval over the user's own documents. Two halves: ingestion
(get content in) and retrieval (get the right chunks out). Both live in the
backend, independent of the Telegram client being open.

## Data model

- `rag_sources`: one row per indexed source (`sourceType`, `path`, `status`,
  `sync_state jsonb`).
- `rag_documents`: one row per source document (`external_id`, `metadata` for
  citations).
- `rag_chunks`: chunked text, cascades from documents.
- `rag_embeddings`: per-chunk vectors for semantic search.
- `rag_retrieval_logs`: query/result audit.

## Retrieval (`/api/rag/search`)

`apps/backend/src/routes/rag.ts`. Hybrid pipeline:

- Embed the query with OpenAI `text-embedding-3-small`.
- Vector similarity + keyword candidates fused by Reciprocal Rank Fusion
  (`RAG_RRF_K`, default 60).
- Rerank: MMR by default (`RAG_MMR_LAMBDA` for diversity); optional LLM listwise
  rerank when enabled, falling back to MMR.

Retrieval ranking is shared by every source. Adding a source type never changes
the ranking path.

## Ingestion

Sources share one `index-document` path (chunk → embed → upsert, deduped by
content hash). Manual push routes and automated sync both use it.

### Agent-facing tools

The backend agent can ingest and retrieve archive content mid-conversation
(`packages/agent-core/src/index-{text,url,document}.ts`, `deep-research.ts`):

- **`index_text`** — index a pasted snippet the user asks to remember.
- **`index_url`** — fetch a link's readable content and index it; the backend
  does the fetching, the model only passes the URL.
- **`index_document`** — index the most recently uploaded PDF/Word file. The
  tool takes only an optional title, not the content: the backend supplies the
  text it already extracted server-side for that turn, so large documents are
  never truncated through the model's output budget (see issue #102 and
  `specs/archive/superpowers/specs/2026-08-04-index-document-reference-redesign-design.md`).
- **`deep_research`** — retrieval side of the loop: searches the user's indexed
  documents for relevant passages via the shared `/api/rag/search` pipeline.

All three ingestion tools write to the same archive `deep_research` reads from.

### Google Drive auto-sync

Indexes user-selected Drive folders and keeps them fresh, entirely backend-side.

- **Selection:** `POST /api/rag/drive/sources { folderId, name }` creates a
  `google-drive` source, captures the Drive `startPageToken` before backfilling.
- **Backfill:** batched (~20 files/tick) so a Worker invocation never runs long;
  status `backfilling → active`.
- **Incremental:** a Cloudflare Cron Trigger iterates `active` sources and calls
  the Drive Changes API — changed files re-index (hash-dedup skips unchanged
  content), trashed files delete their document (chunks/embeddings cascade).
- **Scope:** direct children of the folder only in v1.
- **File types:** Google-native (Docs/Sheets/Slides) plus `txt`, `md`, `csv`,
  `json`. PDFs and Office files are skipped and counted in `filesSkipped`.

Design detail: `specs/archive/superpowers/specs/2026-07-06-drive-rag-autosync-design.md`.
