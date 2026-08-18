// One-off backfill: every user needs a leaderboard handle now that the
// leaderboard shows everyone by default, not just users who opted in.
// Generates one for any row where it's still null.
//
//   bun apps/backend/scripts/backfill-leaderboard-handles.ts

import { isNull } from "drizzle-orm"
import { db } from "@yomi/db"
import { user } from "../src/auth-schema.js"
import { ensureLeaderboardHandle } from "../src/services/streaks.js"

const rows = await db
  .select({ id: user.id, email: user.email })
  .from(user)
  .where(isNull(user.leaderboardHandle))

console.log(`backfilling handles for ${rows.length} user(s)...`)

for (const row of rows) {
  const handle = await ensureLeaderboardHandle(row.id)
  console.log(`  ${row.email} -> ${handle}`)
}

console.log("done")
