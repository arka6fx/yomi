# Spec 11 - Database

## Purpose

Define the Drizzle schema, Neon Postgres usage, and migration workflow. The backend is the only process that talks to Neon. Desktop and sidecar access cloud data only through backend APIs.

## Invariants

- Drizzle ORM is the database interface.
- Migrations are committed under `packages/db/drizzle`.
- `DATABASE_URL` is set only in backend/database environments.
- Better Auth user IDs are text, so app tables use text `user_id`.
- Personal local memory in `~/.yomi` is not synced to Neon.
- Cloud RAG stores only user-selected uploaded documents.

## Auth And Account Tables

Better Auth owns the core auth tables:

- `user`
- `session`
- `account`
- `verification`

The `user` table is extended with product fields:

| Column | Type | Notes |
|---|---|---|
| `plan` | `explore | pro | max` | Defaults to `explore` |
| `subscription_status` | text/null | `active`, `trialing`, `past_due`, `canceled`, or null |
| `trial_ends_at` | timestamp/null | Explore trial end |
| `daily_interaction_count` | integer | Daily fair-use counter |
| `daily_interaction_date` | date/null | UTC reset key |

## App Tables

Core app tables:

| Table | Purpose |
|---|---|
| `devices` | Registered desktop installs and last-seen metadata |
| `subscriptions` | Razorpay customer/subscription mapping |
| `usage_events` | Append-only metering events |
| `memory_blobs` | Legacy/future encrypted sync placeholder; not used for local memory by default |
| `agent_runs` | Agent task history |
| `mcp_connections` | Future OAuth MCP integrations |
| `hook_logs` | Redacted hook audit events |

## Cloud RAG Tables

Cloud RAG uses the existing Neon database and pgvector. A separate Neon project is not required.

| Table | Purpose |
|---|---|
| `rag_sources` | One user-selected uploaded source |
| `rag_documents` | Extracted text document per source |
| `rag_chunks` | Chunked text windows for retrieval |
| `rag_embeddings` | Embedding vector for each chunk |
| `rag_retrieval_logs` | Lightweight retrieval audit/metrics |

Important fields:

- `rag_sources.user_id`: owner, text foreign key to Better Auth user
- `rag_sources.status`: `indexing`, `ready`, `error`, `deleted`
- `rag_documents.content_hash`: dedupe/change detection
- `rag_chunks.chunk_index`: stable order within a document
- `rag_embeddings.embedding`: pgvector embedding, currently `text-embedding-3-small`

Delete behavior: deleting a source removes its documents, chunks, and embeddings through backend logic and cascade relationships.

## Migration Workflow

```bash
bun run db:generate
bun run db:migrate
bun run db:studio
```

Use the `source-command-db-migrate` workflow when generating new Drizzle migrations.

## Implemented Files

- `packages/db/src/schema.ts`
- `packages/db/drizzle/0004_cloud_rag.sql`
- `packages/db/drizzle/meta/_journal.json`

## Future Work

- RAG evaluation tables for offline benchmarks.
- Optional encrypted source payloads before storage.
- A cleanup job for stale `indexing` sources after failed uploads.
