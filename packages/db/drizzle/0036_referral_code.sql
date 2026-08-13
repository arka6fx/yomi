ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "referral_code" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_referral_code_unique" ON "user" ("referral_code");
