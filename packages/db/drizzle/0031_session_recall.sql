ALTER TABLE "agent_sessions" ADD COLUMN IF NOT EXISTS "summary_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("title", '') || ' ' || coalesce("summary", ''))
  ) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_tsv_idx" ON "agent_sessions" USING gin ("summary_tsv");
