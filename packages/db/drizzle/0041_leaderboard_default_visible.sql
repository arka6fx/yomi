ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "custom_avatar_key" text;
ALTER TABLE "user" ALTER COLUMN "leaderboard_opt_in" SET DEFAULT true;
UPDATE "user" SET "leaderboard_opt_in" = true WHERE "leaderboard_opt_in" = false;
