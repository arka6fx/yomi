CREATE TABLE IF NOT EXISTS suggestion_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  dedup_key text NOT NULL,
  decision text NOT NULL,
  schedule_id uuid REFERENCES schedules(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT suggestion_decisions_user_key_unique UNIQUE (user_id, dedup_key)
);
CREATE INDEX IF NOT EXISTS suggestion_decisions_user_idx ON suggestion_decisions (user_id);
