create table if not exists "pending_actions" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" text not null references "user"("id") on delete cascade,
  "connector" text not null,
  "action" text not null,
  "risk" text not null,
  "title" text not null,
  "preview" text not null,
  "confirm_text" text,
  "payload" jsonb not null,
  "status" text not null default 'pending',
  "result" jsonb,
  "source_platform" text,
  "source_chat_id" text,
  "requested_by_run_id" uuid references "agent_runs"("id") on delete set null,
  "expires_at" timestamp not null,
  "decided_at" timestamp,
  "executed_at" timestamp,
  "created_at" timestamp not null default now(),
  "updated_at" timestamp not null default now()
);

create index if not exists "pending_actions_user_status_idx"
  on "pending_actions" ("user_id", "status", "created_at");

create index if not exists "pending_actions_expires_idx"
  on "pending_actions" ("status", "expires_at");

create index if not exists "pending_actions_connector_action_idx"
  on "pending_actions" ("connector", "action");
