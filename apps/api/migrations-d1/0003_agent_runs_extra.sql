-- Run inputs the dispatcher needs without re-deriving them.
ALTER TABLE "agent_runs" ADD COLUMN "duration_seconds" INTEGER;
ALTER TABLE "agent_runs" ADD COLUMN "plan" TEXT;
