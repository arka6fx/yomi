// Provisions the Google OAuth reviewer's test account: Max plan, active subscription, and a
// large credit grant. Deliberately NOT an owner email — isOwnerUser() also gates /admin, which
// would hand the reviewer a destructive reset-all-usage endpoint and our cost analytics.
//
//   bun apps/backend/scripts/provision-review-account.ts <email> [credits]

import { db } from "@yomi/db"
import { eq } from "drizzle-orm"
import { user } from "../src/auth-schema.js"
import { grantCredits } from "../src/services/credit-ledger.js"

const email = process.argv[2]
const credits = Number.parseInt(process.argv[3] ?? "5000", 10)

if (!email) {
  console.error("usage: bun scripts/provision-review-account.ts <email> [credits]")
  process.exit(1)
}

const [account] = await db.select().from(user).where(eq(user.email, email)).limit(1)

if (!account) {
  console.error(`no user row for ${email} — sign in to Yomi with that account once, then re-run`)
  process.exit(1)
}

// Verification runs 4-6 weeks; an explore trial would expire mid-review and lock the reviewer out.
await db
  .update(user)
  .set({ plan: "max", subscriptionStatus: "active", trialEndDate: null })
  .where(eq(user.id, account.id))

const { granted, balance } = await grantCredits({
  userId: account.id,
  amount: credits,
  source: "admin_adjustment",
  sourceId: `oauth-review-${account.id}`,
  idempotencyKey: `oauth-review-${account.id}`,
  reason: "google oauth verification reviewer account",
})

console.log(`${email} -> plan=max, subscription=active`)
console.log(granted ? `granted ${credits} credits, balance ${balance}` : `already granted, balance ${balance}`)
console.log(`role=${account.role} (must not be owner)`)
