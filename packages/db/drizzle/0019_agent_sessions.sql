create table if not exists "agent_sessions" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" text not null references "user"("id") on delete cascade,
  "platform" text not null,
  "chat_id" text not null,
  "title" text,
  "summary" text,
  "status" text not null default 'active',
  "message_count" integer not null default 0,
  "created_at" timestamp not null default now(),
  "updated_at" timestamp not null default now(),
  "last_message_at" timestamp not null default now(),
  "closed_at" timestamp
);

create index if not exists "agent_sessions_user_platform_idx"
  on "agent_sessions" ("user_id", "platform", "chat_id");

create index if not exists "agent_sessions_user_status_idx"
  on "agent_sessions" ("user_id", "status", "last_message_at");

create unique index if not exists "agent_sessions_one_active_chat_idx"
  on "agent_sessions" ("user_id", "platform", "chat_id") where "status" = 'active';

create table if not exists "agent_messages" (
  "id" uuid primary key default gen_random_uuid(),
  "session_id" uuid not null references "agent_sessions"("id") on delete cascade,
  "user_id" text not null references "user"("id") on delete cascade,
  "role" text not null,
  "content" text not null,
  "metadata" jsonb,
  "created_at" timestamp not null default now()
);

create index if not exists "agent_messages_session_created_idx"
  on "agent_messages" ("session_id", "created_at");

create index if not exists "agent_messages_user_created_idx"
  on "agent_messages" ("user_id", "created_at");
