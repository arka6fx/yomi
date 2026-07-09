# Spec 16 - RAG

Backend-owned retrieval over the user's own documents. Two halves: ingestion
(get content in) and retrieval (get the right chunks out). Both live in the
backend so they work even when the desktop app is closed.

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

Design detail: `docs/superpowers/specs/2026-07-06-drive-rag-autosync-design.md`.
