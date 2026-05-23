-- Add trial interaction pool columns for Explore plan shared interaction limit
ALTER TABLE "user" ADD COLUMN "trial_interaction_used" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "trial_interaction_limit" integer NOT NULL DEFAULT 150;
