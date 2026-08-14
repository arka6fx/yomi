import {
  PLANS,
  type FeatureKey,
  type PlanKey,
  featureLimit as planFeatureLimit,
  getPlan,
} from "@yomi/shared/plans"

type EntitlementUser = {
  id?: string | null
  email?: string | null
  role?: string | null
  plan?: string | null
}

type RenewalUser = EntitlementUser & {
  createdAt?: Date | null
  trialEndDate?: Date | null
  currentPeriodEnd?: Date | null
}

// "none" — a paid plan with no billing period on record yet.
export type CreditRenewal = {
  kind: "renewal" | "none"
  at: Date | null
}

const TRIAL_MS = 30 * 24 * 60 * 60 * 1000

export function effectiveRoleForUser(user: EntitlementUser): string {
  return user.role ?? "user"
}

export function effectivePlanForUser(user: EntitlementUser): string {
  const plan = user.plan ?? "explore"
  return plan in PLANS ? plan : "explore"
}

// Explore renews every month like a paid plan now (see explore-renewal.ts's cron
// sweep) rather than expiring after a one-off trial grant, so it reports the same
// "renewal" kind — trialEndDate is the recurring renewal date, not an end date.
// Paid plans are re-granted by the Dodo cycle webhook at currentPeriodEnd (billing.ts).
export function creditRenewal(user: RenewalUser): CreditRenewal {
  if (effectivePlanForUser(user) === "explore") {
    const trialEnd =
      user.trialEndDate ?? (user.createdAt ? new Date(user.createdAt.getTime() + TRIAL_MS) : null)
    return trialEnd ? { kind: "renewal", at: trialEnd } : { kind: "none", at: null }
  }

  return user.currentPeriodEnd
    ? { kind: "renewal", at: user.currentPeriodEnd }
    : { kind: "none", at: null }
}

export function requestLimitForUser(user: EntitlementUser): number | null {
  const plan = effectivePlanForUser(user) as PlanKey
  return planFeatureLimit(plan, "chat") as number
}

export function featureLimitForUser(user: EntitlementUser, feature: FeatureKey): number | null {
  const plan = effectivePlanForUser(user) as PlanKey
  return planFeatureLimit(plan, feature) as number
}

export function getPlanConfig(user: EntitlementUser) {
  const plan = effectivePlanForUser(user)
  return getPlan(plan)
}

export function hasBillablePlanAccess(
  user: EntitlementUser & {
    subscriptionStatus?: string | null
    currentPeriodEnd?: Date | null
    trialEndDate?: Date | null
  },
): boolean {
  const plan = effectivePlanForUser(user)

  if (plan === "explore") {
    console.warn(
      `[hasBillablePlanAccess] explore trial check: trialEndDate=${user.trialEndDate} now=${new Date()} result=${!user.trialEndDate ? "false(no trialEndDate)" : new Date() < user.trialEndDate}`,
    )
    if (!user.trialEndDate) return false
    return new Date() < user.trialEndDate
  }

  if (user.subscriptionStatus === "active" || user.subscriptionStatus === "trialing") return true

  if (user.subscriptionStatus === "past_due") {
    const refMs = user.currentPeriodEnd?.getTime() ?? Date.now()
    const graceEnd = new Date(refMs + 7 * 24 * 60 * 60 * 1000)
    if (new Date() < graceEnd) return true
  }

  return false
}
