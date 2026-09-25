-- User-facing Vault: logins, cards, addresses, phones and agent-held accounts.
-- Secret fields are AES-256-GCM ciphertext (yomi.crypto); the model only ever
-- sees the item id and the non-secret "public" fields.
CREATE TABLE IF NOT EXISTS "vault_items" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "user_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "public" TEXT NOT NULL DEFAULT '{}',
  "secret" TEXT,
  "owner" TEXT NOT NULL DEFAULT 'user',
  "last_used_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "vault_items_user_kind_idx" ON "vault_items" ("user_id", "kind");

-- Every payment the agent asked to make with a vault card. A row starts
-- "pending" (awaiting approval), becomes "authorized" once approved (the card
-- may then be typed into checkout until "expires_at"), and ends "completed",
-- "rejected" or "expired".
CREATE TABLE IF NOT EXISTS "vault_payments" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "user_id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "merchant" TEXT NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "purpose" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "pending_action_id" TEXT,
  "expires_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "vault_payments_user_created_idx" ON "vault_payments" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "vault_payments_item_status_idx" ON "vault_payments" ("item_id", "status");
