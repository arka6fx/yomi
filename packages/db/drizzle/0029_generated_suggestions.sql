CREATE TABLE IF NOT EXISTS generated_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  dedup_key text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  schedule text NOT NULL,
  prompt text NOT NULL,
  deliver_to jsonb,
  connector text NOT NULL,
  time_bucket text NOT NULL,
  distinct_days integer NOT NULL,
  generated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT generated_suggestions_user_key_unique UNIQUE (user_id, dedup_key)
);
CREATE INDEX IF NOT EXISTS generated_suggestions_user_idx ON generated_suggestions (user_id);
