UPDATE "user"
SET "trial_start_date" = "trial_end_date" - interval '30 days'
WHERE "plan" = 'explore'
  AND "trial_start_date" IS NULL
  AND "trial_end_date" IS NOT NULL;
--> statement-breakpoint
UPDATE "user"
SET "trial_end_date" = "trial_start_date" + interval '30 days'
WHERE "plan" = 'explore'
  AND "trial_start_date" IS NOT NULL
  AND "trial_end_date" IS NULL;
--> statement-breakpoint
UPDATE "user"
SET
  "trial_start_date" = "created_at",
  "trial_end_date" = "created_at" + interval '30 days'
WHERE "plan" = 'explore'
  AND "trial_start_date" IS NULL
  AND "trial_end_date" IS NULL;
