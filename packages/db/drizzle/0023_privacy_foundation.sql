-- 0023 — Privacy foundation for DPDP compliance
--
-- Adds consent history, current privacy preferences, export/deletion job tracking,
-- and append-only privacy audit events. Statements are idempotent for safe deploys.

alter table "user" add column if not exists "deleted_at" timestamp;
--> statement-breakpoint
alter table "user" add column if not exists "privacy_preferences" jsonb not null default '{}'::jsonb;
--> statement-breakpoint
alter table "user" add column if not exists "consent_version" text;
--> statement-breakpoint
alter table "user" add column if not exists "consent_timestamp" timestamp;
--> statement-breakpoint
alter table "user" add column if not exists "privacy_policy_version" text;
--> statement-breakpoint
alter table "user" add column if not exists "terms_version" text;
--> statement-breakpoint
alter table "user" add column if not exists "last_export_at" timestamp;
--> statement-breakpoint
alter table "user" add column if not exists "export_count" integer not null default 0;
--> statement-breakpoint

create table if not exists "privacy_consents" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" text not null references "user"("id") on delete cascade,
  "purpose" text not null,
  "status" text not null,
  "consent_version" text not null,
  "privacy_policy_version" text not null,
  "terms_version" text not null,
  "app_version" text,
  "ip_address" text,
  "user_agent" text,
  "metadata" jsonb,
  "created_at" timestamp not null default now()
);
--> statement-breakpoint
create index if not exists "privacy_consents_user_purpose_idx"
  on "privacy_consents" ("user_id", "purpose", "created_at");
--> statement-breakpoint
create index if not exists "privacy_consents_user_status_idx"
  on "privacy_consents" ("user_id", "status");
--> statement-breakpoint

create table if not exists "privacy_preferences" (
  "user_id" text primary key references "user"("id") on delete cascade,
  "conversation_history_enabled" boolean not null default false,
  "memory_enabled" boolean not null default false,
  "cloud_memory_enabled" boolean not null default false,
  "connectors_enabled" boolean not null default false,
  "analytics_enabled" boolean not null default false,
  "voice_processing_enabled" boolean not null default false,
  "screen_processing_enabled" boolean not null default false,
  "ai_improvement_enabled" boolean not null default false,
  "retention_overrides" jsonb,
  "updated_at" timestamp not null default now()
);
--> statement-breakpoint

create table if not exists "privacy_exports" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" text not null references "user"("id") on delete cascade,
  "status" text not null default 'queued',
  "format" text not null default 'json',
  "manifest" jsonb,
  "archive_url" text,
  "archive_sha256" text,
  "error" text,
  "requested_at" timestamp not null default now(),
  "completed_at" timestamp,
  "expires_at" timestamp
);
--> statement-breakpoint
create index if not exists "privacy_exports_user_status_idx"
  on "privacy_exports" ("user_id", "status", "requested_at");
--> statement-breakpoint

create table if not exists "privacy_deletion_jobs" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" text not null,
  "kind" text not null,
  "status" text not null default 'queued',
  "steps" jsonb not null default '[]'::jsonb,
  "error" text,
  "requested_at" timestamp not null default now(),
  "completed_at" timestamp
);
--> statement-breakpoint
create index if not exists "privacy_deletion_jobs_user_status_idx"
  on "privacy_deletion_jobs" ("user_id", "status", "requested_at");
--> statement-breakpoint

create table if not exists "privacy_audit_events" (
  "id" uuid primary key default gen_random_uuid(),
  "actor_user_id" text,
  "target_user_id" text,
  "event_type" text not null,
  "resource_type" text,
  "resource_id" text,
  "ip_address" text,
  "user_agent" text,
  "metadata" jsonb,
  "created_at" timestamp not null default now()
);
--> statement-breakpoint
create index if not exists "privacy_audit_events_target_created_idx"
  on "privacy_audit_events" ("target_user_id", "created_at");
--> statement-breakpoint
create index if not exists "privacy_audit_events_actor_created_idx"
  on "privacy_audit_events" ("actor_user_id", "created_at");
--> statement-breakpoint
create index if not exists "privacy_audit_events_type_idx"
  on "privacy_audit_events" ("event_type", "created_at");
