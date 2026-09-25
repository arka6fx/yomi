-- Web sign-in with Telegram: the browser holds `token`; the user confirms in the
-- bot (matching `code`), then the browser exchanges the approved row for a session.
CREATE TABLE IF NOT EXISTS "telegram_login_requests" (
  "token" TEXT PRIMARY KEY NOT NULL,
  "code" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "user_id" TEXT,
  "user_agent" TEXT,
  "ip_address" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "telegram_login_requests_expires_idx" ON "telegram_login_requests" ("expires_at");
