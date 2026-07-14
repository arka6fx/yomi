import {
  PLANS,
  type FeatureKey,
  type PlanKey,
  featureLimit as planFeatureLimit,
  getPlan,
} from "@yomi/shared/plans"

const DEFAULT_OWNER_EMAILS = ["arkagarai292@gmail.com"]

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

// "none" — owner (credits bypassed) or a paid plan with no billing period on record yet.
export type CreditRenewal = {
  kind: "renewal" | "trial_expiry" | "none"
  at: Date | null
}

const TRIAL_MS = 30 * 24 * 60 * 60 * 1000

function parseList(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  )
}

function ownerEmails(): Set<string> {
  return new Set(
    [
      ...DEFAULT_OWNER_EMAILS,
      ...parseList(process.env["OWNER_EMAIL"]),
      ...parseList(process.env["OWNER_EMAILS"]),
    ].map((email) => email.toLowerCase()),
  )
}

function ownerUserIds(): Set<string> {
  return new Set(parseList(process.env["OWNER_USER_IDS"]))
}

export function isOwnerUser(user: EntitlementUser): boolean {
  if (user.role === "owner") return true
  const email = user.email?.toLowerCase()
  if (email && ownerEmails().has(email)) return true
  const id = user.id ?? undefined
  return !!id && ownerUserIds().has(id)
}

export function effectiveRoleForUser(user: EntitlementUser): string {
  return isOwnerUser(user) ? "owner" : (user.role ?? "user")
}

export function effectivePlanForUser(user: EntitlementUser): string {
  if (isOwnerUser(user)) return "max"
  const plan = user.plan ?? "explore"
  return plan in PLANS ? plan : "explore"
}

// Credits are granted per user, never on a calendar boundary: explore gets a one-off
// trial grant that expires (auth.ts signup), paid plans are re-granted by the Dodo
// cycle webhook at currentPeriodEnd (routes/billing.ts).
export function creditRenewal(user: RenewalUser): CreditRenewal {
  if (isOwnerUser(user)) return { kind: "none", at: null }

  if (effectivePlanForUser(user) === "explore") {
    const trialEnd =
      user.trialEndDate ?? (user.createdAt ? new Date(user.createdAt.getTime() + TRIAL_MS) : null)
    return trialEnd ? { kind: "trial_expiry", at: trialEnd } : { kind: "none", at: null }
  }

  return user.currentPeriodEnd
    ? { kind: "renewal", at: user.currentPeriodEnd }
    : { kind: "none", at: null }
}

export function requestLimitForUser(user: EntitlementUser): number | null {
  if (isOwnerUser(user)) return null
  const plan = effectivePlanForUser(user) as PlanKey
  return planFeatureLimit(plan, "chat") as number
}

export function featureLimitForUser(user: EntitlementUser, feature: FeatureKey): number | null {
  if (isOwnerUser(user)) return null
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
  if (isOwnerUser(user)) return true
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
