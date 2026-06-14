// Run from apps/backend: bun run ../../scripts/repair-missing-credits.ts
// Or copy to apps/backend and run: bun run repair-missing-credits.ts
import { db, creditAccounts, creditGrants, creditTransactions } from "@yomi/db"
import * as authSchema from "../apps/backend/src/auth-schema.js"
import { inArray, eq, sql } from "drizzle-orm"

const MISSING_EMAILS = [
  "soubhik@example.com",
  "cpun@example.com",
  "saptak@example.com",
  "saptak@college.edu",
]

async function run() {
  const users = await db
    .select({ id: authSchema.user.id, email: authSchema.user.email })
    .from(authSchema.user)
    .where(inArray(authSchema.user.email, MISSING_EMAILS))

  if (!users.length) { console.log("No users found"); return }

  for (const u of users) {
    await db.insert(creditAccounts).values({ userId: u.id }).onConflictDoNothing()
    const expiresAt = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000)

    const [grant] = await db
      .insert(creditGrants)
      .values({
        userId: u.id,
        source: "subscription_cycle" as const,
        sourceId: `signup:${u.id}:explore`,
        creditsGranted: 100,
        creditsRemaining: 100,
        expiresAt,
        metadata: { plan: "explore", retroactive: true },
      })
      .onConflictDoNothing()
      .returning({ id: creditGrants.id })

    if (!grant) { console.log(`${u.email}: already has grant, skipping`); continue }

    const [account] = await db
      .update(creditAccounts)
      .set({
        availableCredits: sql`${creditAccounts.availableCredits} + 100`,
        lifetimeGranted: sql`${creditAccounts.lifetimeGranted} + 100`,
        updatedAt: new Date(),
      })
      .where(eq(creditAccounts.userId, u.id))
      .returning({ availableCredits: creditAccounts.availableCredits })

    await db
      .insert(creditTransactions)
      .values({
        userId: u.id,
        grantId: grant.id,
        type: "grant" as const,
        amount: 100,
        balanceAfter: account?.availableCredits ?? 100,
        idempotencyKey: `signup:${u.id}:explore_credits`,
        reason: "Explore monthly credits (retroactive repair)",
        metadata: { plan: "explore", retroactive: true },
      })
      .onConflictDoNothing()

    console.log(`OK ${u.email}: 100 credits, balance now ${account?.availableCredits}`)
  }
}

run().catch(console.error).then(() => process.exit(0))
