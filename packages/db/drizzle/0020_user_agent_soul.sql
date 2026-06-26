ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "agent_soul" text;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "soul_onboarding" text NOT NULL DEFAULT 'unprompted';
