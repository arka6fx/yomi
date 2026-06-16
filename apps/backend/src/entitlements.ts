import { PLANS, type FeatureKey, type PlanKey, featureLimit as planFeatureLimit, getPlan } from "@yomi/shared/plans"

const DEFAULT_OWNER_EMAILS = ["arkagarai292@gmail.com"]

type EntitlementUser = {
  id?: string | null
  email?: string | null
  role?: string | null
  plan?: string | null
}

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

export function hasBillablePlanAccess(user: EntitlementUser & { subscriptionStatus?: string | null; currentPeriodEnd?: Date | null; trialEndDate?: Date | null }): boolean {
  if (isOwnerUser(user)) return true
  const plan = effectivePlanForUser(user)

  if (plan === "explore") {
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
