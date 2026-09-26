// Every dashboard view; the shell switches between them in place. Kept as a list
// so links like /dashboard?tab=computer can be checked at runtime.
export const DASHBOARD_TABS = [
  "home",
  "skills",
  "characters",
  "computer",
  "activity",
  "approvals",
  "vault",
  "trusted",
  "email",
  "integrations",
  "memory",
  "schedules",
  "conversation",
  "history",
  "status",
  "billing",
  "profile",
  "writing-style",
  "privacy",
  "referrals",
  "streaks",
] as const

export type DashboardTab = (typeof DASHBOARD_TABS)[number]
