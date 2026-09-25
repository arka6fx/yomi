-- Cron/phrase schedules fire at local wall-clock times in this IANA zone.
ALTER TABLE "schedules" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';
