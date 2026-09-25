-- Per-user inbound address (<alias>@mail.getyomi.in) via Cloudflare Email Routing.
CREATE TABLE IF NOT EXISTS "email_aliases" (
  "user_id" TEXT PRIMARY KEY NOT NULL,
  "alias" TEXT NOT NULL UNIQUE,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);

-- Emails received at the alias. Bodies are untrusted third-party content.
CREATE TABLE IF NOT EXISTS "inbound_emails" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "user_id" TEXT NOT NULL,
  "from_addr" TEXT NOT NULL,
  "subject" TEXT NOT NULL DEFAULT '',
  "body_text" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL DEFAULT 'email',
  "read_at" TEXT,
  "received_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "inbound_emails_user_received_idx" ON "inbound_emails" ("user_id", "received_at");

-- Spending found in receipts (emailed or forwarded), alongside vault payments.
CREATE TABLE IF NOT EXISTS "expenses" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "user_id" TEXT NOT NULL,
  "merchant" TEXT NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "occurred_on" TEXT,
  "source" TEXT NOT NULL DEFAULT 'email',
  "source_id" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "expenses_user_created_idx" ON "expenses" ("user_id", "created_at");
