-- 0024 — ai_usage_events: rich per-request AI telemetry (spec 22 phase 1)
-- Additive companion to usage_events. Idempotent for safe deploys.

create table if not exists "ai_usage_events" (
  "id" uuid primary key default gen_random_uuid(),
  "usage_event_id" uuid references "usage_events"("id") on delete set null,
  "user_id" text not null references "user"("id") on delete cascade,
  "request_id" text not null,
  "endpoint" text not null,
  "surface" text not null,
  "route" text,
  "intent" text,
  "complexity" text,
  "model" text,
  "provider" text,
  "input_tokens" integer not null default 0,
  "output_tokens" integer not null default 0,
  "reasoning_tokens" integer not null default 0,
  "cached_input_tokens" integer not null default 0,
  "embedding_tokens" integer not null default 0,
  "max_output_tokens" integer not null default 0,
  "tool_calls" integer not null default 0,
  "connector_count" integer not null default 0,
  "connector_ids" text[] not null default '{}',
  "vision_images" integer not null default 0,
  "voice_duration_seconds" integer not null default 0,
  "tts_chars" integer not null default 0,
  "stt_audio_seconds" integer not null default 0,
  "latency_ms" integer not null default 0,
  "first_token_latency_ms" integer,
  "total_api_cost_micros" integer not null default 0,
  "credit_policy_version" text not null default 'static-v1',
  "credits_estimated" integer not null default 0,
  "credits_charged" integer not null default 0,
  "status" text not null default 'started',
  "error_code" text,
  "metadata" jsonb,
  "created_at" timestamp not null default now(),
  "completed_at" timestamp
);
--> statement-breakpoint
create unique index if not exists "ai_usage_events_request_id_uq"
  on "ai_usage_events" ("request_id");
--> statement-breakpoint
create index if not exists "ai_usage_events_user_created_idx"
  on "ai_usage_events" ("user_id", "created_at");
--> statement-breakpoint
create index if not exists "ai_usage_events_endpoint_idx"
  on "ai_usage_events" ("endpoint", "created_at");
--> statement-breakpoint
create index if not exists "ai_usage_events_model_idx"
  on "ai_usage_events" ("model", "created_at");
--> statement-breakpoint
create index if not exists "ai_usage_events_status_idx"
  on "ai_usage_events" ("status");
--> statement-breakpoint
create index if not exists "ai_usage_events_usage_event_idx"
  on "ai_usage_events" ("usage_event_id");
