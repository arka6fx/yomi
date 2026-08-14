import { and, eq, isNull, lte, or } from "drizzle-orm"
import { db, creditAccounts } from "@yomi/db"
import { user } from "../auth-schema.js"
import { grantCredits } from "./credit-ledger.js"
import { getPlan } from "@yomi/shared/plans"

const CYCLE_DAYS = 30
const PAID_PLANS = new Set(["pro", "max"])

export type PlanRenewalResult = { renewed: number; creditsGranted: number }

// Real paid-plan accounts renew via Dodo's subscription_active webhook firing
// again at currentPeriodEnd (billing.ts handleSubscriptionActive). An account
// that's plan=pro/max + subscriptionStatus=active but has no real Dodo
// subscription behind it (dodoSubscriptionId is null — provisioned directly,
// e.g. scripts/provision-review-account.ts or an admin data fix) never gets
// that webhook, so without this sweep its credits would run out once and
// never come back. Safe to key off dodoSubscriptionId=null: cancellation
// (handleSubscriptionEnd) resets plan to explore and clears both
// dodoSubscriptionId and currentPeriodEnd, so a cancelled real subscriber
// never matches this query — only genuinely non-billed accounts do.
export async function renewNonBilledPaidCredits(
  now: Date = new Date(),
): Promise<PlanRenewalResult> {
  const day = now.toISOString().slice(0, 10)
  const nextPeriodEnd = new Date(now.getTime() + CYCLE_DAYS * 24 * 60 * 60 * 1000)

  const candidates = await db
    .select({ id: user.id, plan: user.plan })
    .from(user)
    .where(
      and(
        isNull(user.deletedAt),
        isNull(user.dodoSubscriptionId),
        eq(user.subscriptionStatus, "active"),
        or(isNull(user.currentPeriodEnd), lte(user.currentPeriodEnd, now)),
      ),
    )
  const paidCandidates = candidates.filter((u) => PAID_PLANS.has(u.plan))
  if (paidCandidates.length === 0) return { renewed: 0, creditsGranted: 0 }

  const accounts = await db
    .select({ userId: creditAccounts.userId, balance: creditAccounts.availableCredits })
    .from(creditAccounts)
  const balanceByUser = new Map(accounts.map((a) => [a.userId, a.balance]))

  let renewed = 0
  let creditsGranted = 0

  for (const u of paidCandidates) {
    const included = getPlan(u.plan).includedCredits
    const balance = balanceByUser.get(u.id) ?? 0
    const topUp = Math.max(0, included - balance)

    await db.update(user).set({ currentPeriodEnd: nextPeriodEnd }).where(eq(user.id, u.id))

    if (topUp > 0) {
      await grantCredits({
        userId: u.id,
        amount: topUp,
        source: "subscription_cycle",
        sourceId: `plan-renewal:${day}:${u.id}`,
        idempotencyKey: `plan-renewal:${day}:${u.id}`,
        expiresAt: nextPeriodEnd,
        reason: `${u.plan} monthly renewal (non-billed account)`,
        metadata: { plan: u.plan, nonBilled: true },
      })
      creditsGranted += topUp
    }
    renewed++
  }

  return { renewed, creditsGranted }
}
