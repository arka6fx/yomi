ALTER TABLE "user" ALTER COLUMN "trial_interaction_limit" SET DEFAULT 100;
--> statement-breakpoint
UPDATE "user" SET "trial_interaction_limit" = 100 WHERE "plan" = 'explore' AND "trial_interaction_limit" = 150;
