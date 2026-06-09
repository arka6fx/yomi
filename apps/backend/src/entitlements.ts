const DEFAULT_OWNER_EMAILS = ["arkagarai292@gmail.com"]

type EntitlementUser = {
  id?: string | null
  email?: string | null
  role?: string | null
  plan?: string | null
}

export const PLAN_REQUEST_LIMITS: Record<"explore" | "pro" | "max", number> = {
  explore: 100,
  pro: 2000,
  max: 8000,
}

export const FEATURE_LIMITS = {
  voiceMinutes: { explore: 20, pro: 180, max: 750 },
  screenshots: { explore: 25, pro: 400, max: 2000 },
  reasoning: { explore: 0, pro: 100, max: 500 },
  desktopAutomation: { explore: 0, pro: 75, max: 750 },
  browserAutomation: { explore: 0, pro: 40, max: 500 },
  gatewayMessages: { explore: 50, pro: 2000, max: 8000 },
} as const

export type FeatureKey = keyof typeof FEATURE_LIMITS

export function featureLimitForUser(user: EntitlementUser, feature: FeatureKey): number | null {
  if (isOwnerUser(user)) return null
  const plan = effectivePlanForUser(user) as "explore" | "pro" | "max"
  return FEATURE_LIMITS[feature][plan]
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
  return isOwnerUser(user) ? "max" : (user.plan ?? "explore")
}

export function requestLimitForUser(user: EntitlementUser): number | null {
  if (isOwnerUser(user)) return null
  const plan = effectivePlanForUser(user) as keyof typeof PLAN_REQUEST_LIMITS
  return PLAN_REQUEST_LIMITS[plan] ?? PLAN_REQUEST_LIMITS.explore
}

export function hasBillablePlanAccess(user: EntitlementUser & { subscriptionStatus?: string | null; currentPeriodEnd?: Date | null }): boolean {
  if (isOwnerUser(user)) return true
  const plan = effectivePlanForUser(user)
  if (plan === "explore") return true
  if (user.subscriptionStatus === "active" || user.subscriptionStatus === "trialing") return true

  // Past-due grace: 7 days after period end before hard cutoff
  if (user.subscriptionStatus === "past_due" && user.currentPeriodEnd) {
    const graceEnd = new Date(user.currentPeriodEnd.getTime() + 7 * 24 * 60 * 60 * 1000)
    if (new Date() < graceEnd) return true
  }

  return false
}
