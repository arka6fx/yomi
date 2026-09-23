-- Durable agent runs: enqueue once, execute with leases, recover orphans.
-- update_id is UNIQUE so Telegram redeliveries collapse onto one run
-- (NULL update_ids for non-Telegram runs never collide in SQLite).

CREATE TABLE IF NOT EXISTS "agent_runs" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'telegram',
  "chat_id" TEXT NOT NULL,
  "message_id" INTEGER,
  "update_id" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'chat',
  "input_text" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "lease_owner" TEXT,
  "lease_expires_at" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "result_summary" TEXT,
  "error" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TEXT,
  UNIQUE ("update_id")
);
CREATE INDEX IF NOT EXISTS "agent_runs_user_idx" ON "agent_runs" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "agent_runs_claim_idx" ON "agent_runs" ("status", "lease_expires_at");

CREATE TABLE IF NOT EXISTS "agent_run_steps" (
  "id" TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  "run_id" TEXT NOT NULL REFERENCES "agent_runs" ("id") ON DELETE CASCADE,
  "step_index" INTEGER NOT NULL,
  "tool_name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'done',
  "input" TEXT,
  "output" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "agent_run_steps_run_idx" ON "agent_run_steps" ("run_id", "step_index");
