create table if not exists "schedules" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" text not null references "user"("id") on delete cascade,
  "schedule" text not null,
  "schedule_type" text not null,
  "prompt" text not null,
  "deliver_to" jsonb,
  "enabled" boolean not null default true,
  "one_shot" boolean not null default false,
  "next_run_at" timestamp,
  "last_run_at" timestamp,
  "last_run_status" text,
  "last_run_error" text,
  "run_count" integer not null default 0,
  "created_at" timestamp not null default now(),
  "updated_at" timestamp not null default now()
);

create index if not exists "schedules_user_idx" on "schedules" ("user_id");

create index if not exists "schedules_due_idx" on "schedules" ("enabled", "next_run_at");
