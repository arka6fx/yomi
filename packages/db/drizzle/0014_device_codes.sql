-- Device-code OAuth flow (RFC 8628) persisted in DB so CF Worker isolates share state
CREATE TABLE IF NOT EXISTS "device_codes" (
  "device_code" text PRIMARY KEY NOT NULL,
  "user_code" text NOT NULL,
  "client_id" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "token" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "device_codes_user_code_idx" ON "device_codes" ("user_code");
CREATE INDEX IF NOT EXISTS "device_codes_expires_at_idx" ON "device_codes" ("expires_at");
