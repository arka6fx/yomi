-- Trusted people: Yomi users whose agents may message each other.
-- One row per ordered pair (requester -> target). "pending" until the target
-- accepts (trust is then mutual), declines (row deleted) or blocks.
CREATE TABLE IF NOT EXISTS "trust_links" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "requester_id" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "note" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at" TEXT,
  UNIQUE ("requester_id", "target_id"),
  FOREIGN KEY ("requester_id") REFERENCES "user" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("target_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "trust_links_target_idx" ON "trust_links" ("target_id", "status");

-- Messages one user's agent sent to a trusted person's agent.
CREATE TABLE IF NOT EXISTS "trust_messages" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "sender_id" TEXT NOT NULL,
  "recipient_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "reply_to" TEXT,
  "read_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("sender_id") REFERENCES "user" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("recipient_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "trust_messages_recipient_idx" ON "trust_messages" ("recipient_id", "created_at");

-- Per-user switch: while paused, no agent-to-agent traffic in or out.
CREATE TABLE IF NOT EXISTS "trust_settings" (
  "user_id" TEXT PRIMARY KEY NOT NULL,
  "paused" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
