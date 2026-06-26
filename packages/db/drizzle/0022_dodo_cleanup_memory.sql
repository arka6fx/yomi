-- 0022 — Dodo cleanup + memory catch-up
--
-- Two real changes the live DB needs. Everything else drizzle-kit would have
-- regenerated against the stale 0000 snapshot already exists (applied by hand in
-- 0001–0021) and is intentionally omitted. The 0022 snapshot is the new clean
-- baseline, so future `drizzle-kit generate` runs diff correctly.
--
--   1. Create the memory_* tables. Migration 0017 was never applied, so the
--      memory feature is broken in prod. Recreated here in their full shape —
--      the generated `content_tsv` column plus the GIN/HNSW indexes that the
--      retrieval code (agent/run.ts, routes/memory.ts) depends on.
--   2. Drop legacy/dead tables now that billing runs on Dodo (user fields +
--      payment_records + credit ledger): subscriptions (Stripe-era), plus
--      memory_blobs, hook_logs and agent_runs — none are referenced in code.
--
-- All statements are idempotent and safe to re-run.

-- 1) memory_* (from 0017, never applied) -------------------------------------
create table if not exists "memory_entries" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" text not null,
  "custom_id" text,
  "content_hash" text not null,
  "kind" text not null default 'fact',
  "scope" text not null default 'global',
  "topic" text not null,
  "summary" text,
  "content" text not null,
  "status" text not null default 'active',
  "confidence" integer not null default 70,
  "source_type" text,
  "source_path" text,
  "version" integer not null default 1,
  "is_latest" boolean not null default true,
  "is_static" boolean not null default false,
  "root_memory_id" uuid,
  "parent_memory_id" uuid,
  "forget_after" timestamp,
  "metadata" jsonb,
  "created_at" timestamp not null default now(),
  "updated_at" timestamp not null default now()
);
--> statement-breakpoint
alter table "memory_entries" add column if not exists "content_tsv" tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce("topic", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("summary", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("content", '')), 'C') ||
    setweight(to_tsvector('english', coalesce("kind", '') || ' ' || coalesce("scope", '')), 'D')
  ) stored;
--> statement-breakpoint
create index if not exists "memory_entries_user_status_idx"
  on "memory_entries" ("user_id", "status", "updated_at");
--> statement-breakpoint
create index if not exists "memory_entries_user_topic_idx"
  on "memory_entries" ("user_id", "topic");
--> statement-breakpoint
create unique index if not exists "memory_entries_user_custom_unique"
  on "memory_entries" ("user_id", "custom_id") where "custom_id" is not null;
--> statement-breakpoint
create index if not exists "memory_entries_user_hash_idx"
  on "memory_entries" ("user_id", "content_hash");
--> statement-breakpoint
create index if not exists "memory_entries_tsv_idx"
  on "memory_entries" using gin ("content_tsv");
--> statement-breakpoint
create table if not exists "memory_sources" (
  "id" uuid primary key default gen_random_uuid(),
  "memory_id" uuid not null references "memory_entries"("id") on delete cascade,
  "document_id" uuid references "rag_documents"("id") on delete set null,
  "chunk_id" uuid references "rag_chunks"("id") on delete set null,
  "source_path" text,
  "relevance" integer not null default 100,
  "created_at" timestamp not null default now()
);
--> statement-breakpoint
create index if not exists "memory_sources_memory_idx"
  on "memory_sources" ("memory_id");
--> statement-breakpoint
create table if not exists "memory_relations" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" text not null,
  "from_memory_id" uuid not null references "memory_entries"("id") on delete cascade,
  "to_memory_id" uuid not null references "memory_entries"("id") on delete cascade,
  "relation_type" text not null,
  "created_at" timestamp not null default now()
);
--> statement-breakpoint
create index if not exists "memory_relations_user_from_idx"
  on "memory_relations" ("user_id", "from_memory_id");
--> statement-breakpoint
create unique index if not exists "memory_relations_unique"
  on "memory_relations" ("from_memory_id", "to_memory_id", "relation_type");
--> statement-breakpoint
create table if not exists "memory_embeddings" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" text not null,
  "memory_id" uuid not null references "memory_entries"("id") on delete cascade,
  "model" text not null,
  "embedding" vector(1536) not null,
  "created_at" timestamp not null default now()
);
--> statement-breakpoint
create index if not exists "memory_embeddings_user_idx"
  on "memory_embeddings" ("user_id");
--> statement-breakpoint
create index if not exists "memory_embeddings_memory_idx"
  on "memory_embeddings" ("memory_id");
--> statement-breakpoint
create index if not exists "memory_embeddings_vector_idx"
  on "memory_embeddings" using hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint

-- 2) drop legacy/dead tables -------------------------------------------------
-- cascade removes the pending_actions.requested_by_run_id FK (column is kept as
-- a plain correlation id with no FK in the current schema).
drop table if exists "agent_runs" cascade;
--> statement-breakpoint
drop table if exists "hook_logs";
--> statement-breakpoint
drop table if exists "memory_blobs";
--> statement-breakpoint
drop table if exists "subscriptions";
