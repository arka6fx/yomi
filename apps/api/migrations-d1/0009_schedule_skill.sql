-- Routines added from the skills gallery remember which skill made them.
ALTER TABLE "schedules" ADD COLUMN "skill_id" TEXT;
CREATE INDEX IF NOT EXISTS "schedules_user_skill_idx" ON "schedules" ("user_id", "skill_id");
