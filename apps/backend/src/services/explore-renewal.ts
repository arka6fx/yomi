import { and, eq, isNull, lt } from "drizzle-orm"
import { db, creditAccounts } from "@yomi/db"
import { user } from "../auth-schema.js"
import { effectivePlanForUser, isOwnerUser } from "../entitlements.js"
import { grantCredits } from "./credit-ledger.js"
import { getPlan } from "@yomi/shared/plans"

const TRIAL_DAYS = 30

export type ExploreRenewalResult = { renewed: number; creditsGranted: number }

// Explore is a free tier that renews every month rather than a one-time trial:
// once trialEndDate elapses, the user is topped back up to the plan's included
// credits and the 30-day window restarts. Only acts on users whose window has
// actually ended — never tops up mid-cycle, so running out of the monthly
// allotment still gates usage (and nudges toward upgrading) until renewal.
// hasBillablePlanAccess still hard-blocks past trialEndDate as a fail-safe if
// this sweep is ever delayed or fails.
export async function renewExploreCredits(now: Date = new Date()): Promise<ExploreRenewalResult> {
  const included = getPlan("explore").includedCredits
  const day = now.toISOString().slice(0, 10)
  const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000)

  const candidates = await db
    .select({
      id: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan,
      trialEndDate: user.trialEndDate,
    })
    .from(user)
    .where(and(isNull(user.deletedAt), lt(user.trialEndDate, now)))

  const accounts = await db
    .select({ userId: creditAccounts.userId, balance: creditAccounts.availableCredits })
    .from(creditAccounts)
  const balanceByUser = new Map(accounts.map((a) => [a.userId, a.balance]))

  let renewed = 0
  let creditsGranted = 0

  for (const u of candidates) {
    if (isOwnerUser(u)) continue
    if (effectivePlanForUser(u) !== "explore") continue

    const balance = balanceByUser.get(u.id) ?? 0
    const topUp = Math.max(0, included - balance)

    await db
      .update(user)
      .set({ trialStartDate: now, trialEndDate: trialEnd })
      .where(eq(user.id, u.id))

    if (topUp > 0) {
      await grantCredits({
        userId: u.id,
        amount: topUp,
        source: "subscription_cycle",
        sourceId: `explore-renewal:${day}:${u.id}`,
        idempotencyKey: `explore-renewal:${day}:${u.id}`,
        expiresAt: trialEnd,
        reason: "Explore monthly renewal",
        metadata: { plan: "explore", trialDays: TRIAL_DAYS },
      })
      creditsGranted += topUp
    }
    renewed++
  }

  return { renewed, creditsGranted }
}
