// One-shot: apply migration 0002 and backfill owner account
import { sql } from "drizzle-orm"
import { db } from "../src/index.js"

const DATABASE_URL = process.env["DATABASE_URL"]
if (!DATABASE_URL) throw new Error("DATABASE_URL not set")

const OWNER_EMAIL = process.env["OWNER_EMAIL"] ?? "owner@example.com"

const migration = `
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'user';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "plan" text NOT NULL DEFAULT 'explore';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "subscription_status" text NOT NULL DEFAULT 'inactive';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "trial_start_date" timestamp;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "trial_end_date" timestamp;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "current_period_end" timestamp;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "razorpay_customer_id" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "razorpay_sub_id" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "daily_chat_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "daily_voice_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "daily_image_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "agent_usage_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "daily_reset_date" text;
`

console.log("Applying migration 0002...")
for (const stmt of migration.split(";").map(s => s.trim()).filter(Boolean)) {
  await db.execute(sql.raw(stmt))
  console.log("  ✓", stmt.slice(0, 60))
}

console.log(`\nBackfilling owner: ${OWNER_EMAIL}`)
const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
await db.execute(
  sql.raw(`
    UPDATE "user"
    SET role = 'owner', plan = 'max', subscription_status = 'active'
    WHERE email = '${OWNER_EMAIL}'
  `)
)

// Set explore + trial for all non-owner users who haven't been assigned yet
await db.execute(
  sql.raw(`
    UPDATE "user"
    SET role = 'user', plan = 'explore', subscription_status = 'inactive',
        trial_start_date = NOW(), trial_end_date = '${trialEnd.toISOString()}'
    WHERE email != '${OWNER_EMAIL}' AND trial_start_date IS NULL
  `)
)

// Check result
const rows = await db.execute(sql.raw(`SELECT email, role, plan, subscription_status FROM "user"`))
console.log("\nUser table after migration:")
console.table(rows.rows)

process.exit(0)
