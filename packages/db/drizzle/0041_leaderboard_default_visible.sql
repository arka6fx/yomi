ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "custom_avatar_key" text;
--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "leaderboard_opt_in" SET DEFAULT true;
--> statement-breakpoint
UPDATE "user" SET "leaderboard_opt_in" = true WHERE "leaderboard_opt_in" = false;
