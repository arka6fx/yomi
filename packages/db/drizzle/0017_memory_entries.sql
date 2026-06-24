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

alter table "memory_entries" add column if not exists "content_tsv" tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce("topic", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("summary", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("content", '')), 'C') ||
    setweight(to_tsvector('english', coalesce("kind", '') || ' ' || coalesce("scope", '')), 'D')
  ) stored;

create index if not exists "memory_entries_user_status_idx"
  on "memory_entries" ("user_id", "status", "updated_at");

create index if not exists "memory_entries_user_topic_idx"
  on "memory_entries" ("user_id", "topic");

create unique index if not exists "memory_entries_user_custom_unique"
  on "memory_entries" ("user_id", "custom_id") where "custom_id" is not null;

create index if not exists "memory_entries_user_hash_idx"
  on "memory_entries" ("user_id", "content_hash");

create index if not exists "memory_entries_tsv_idx"
  on "memory_entries" using gin ("content_tsv");

create table if not exists "memory_sources" (
  "id" uuid primary key default gen_random_uuid(),
  "memory_id" uuid not null references "memory_entries"("id") on delete cascade,
  "document_id" uuid references "rag_documents"("id") on delete set null,
  "chunk_id" uuid references "rag_chunks"("id") on delete set null,
  "source_path" text,
  "relevance" integer not null default 100,
  "created_at" timestamp not null default now()
);

create index if not exists "memory_sources_memory_idx"
  on "memory_sources" ("memory_id");

create table if not exists "memory_relations" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" text not null,
  "from_memory_id" uuid not null references "memory_entries"("id") on delete cascade,
  "to_memory_id" uuid not null references "memory_entries"("id") on delete cascade,
  "relation_type" text not null,
  "created_at" timestamp not null default now()
);

create index if not exists "memory_relations_user_from_idx"
  on "memory_relations" ("user_id", "from_memory_id");

create unique index if not exists "memory_relations_unique"
  on "memory_relations" ("from_memory_id", "to_memory_id", "relation_type");

create table if not exists "memory_embeddings" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" text not null,
  "memory_id" uuid not null references "memory_entries"("id") on delete cascade,
  "model" text not null,
  "embedding" vector(1536) not null,
  "created_at" timestamp not null default now()
);

create index if not exists "memory_embeddings_user_idx"
  on "memory_embeddings" ("user_id");

create index if not exists "memory_embeddings_memory_idx"
  on "memory_embeddings" ("memory_id");

create index if not exists "memory_embeddings_vector_idx"
  on "memory_embeddings" using hnsw ("embedding" vector_cosine_ops);
