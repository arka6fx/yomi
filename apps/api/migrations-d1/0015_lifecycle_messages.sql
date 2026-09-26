-- Onboarding and win-back nudges: one row per user per step, so each is sent once.
-- The step 'opted_out' marks someone who asked for no more tips.
CREATE TABLE IF NOT EXISTS "lifecycle_messages" (
  "user_id" TEXT NOT NULL,
  "step" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "sent_at" TEXT NOT NULL,
  PRIMARY KEY ("user_id", "step"),
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "lifecycle_messages_sent_idx" ON "lifecycle_messages" ("user_id", "sent_at");
