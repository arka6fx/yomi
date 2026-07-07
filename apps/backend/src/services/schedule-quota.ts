import { eq, sql } from "drizzle-orm"
import { db, schedules } from "@yomi/db"
import { effectivePlanForUser, getPlanConfig, isOwnerUser } from "../entitlements.js"
import { scheduleLimitForPlan } from "./schedule-parser.js"

// Structurally matches entitlements' EntitlementUser plus the required id.
export interface QuotaUser {
  id: string
  email?: string | null
  role?: string | null
  plan?: string | null
}

export type CapacityResult =
  | { ok: true }
  | { ok: false; status: 402 | 403; body: { error: string; code: string; upgradeUrl: string } }

// The single plan gate for creating a schedule — shared by POST /api/schedules
// and suggestion accepts so the two paths can never drift.
export async function ensureScheduleCapacity(user: QuotaUser): Promise<CapacityResult> {
  if (isOwnerUser(user)) return { ok: true }
  const plan = effectivePlanForUser(user)
  const limit = scheduleLimitForPlan(plan)
  if (limit <= 0) {
    return {
      ok: false,
      status: 403,
      body: {
        error: `Scheduling isn't on your ${getPlanConfig(user).name} plan. Upgrade to Pro or Max to schedule tasks.`,
        code: "feature_not_available",
        upgradeUrl: "/dashboard?upgrade=true",
      },
    }
  }
  const countRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(schedules)
    .where(eq(schedules.userId, user.id))
  const count = Number(countRows[0]?.count ?? 0)
  if (count >= limit) {
    return {
      ok: false,
      status: 402,
      body: {
        error: `You've hit your schedule limit (${count}/${limit}). Upgrade for more.`,
        code: "schedule_limit",
        upgradeUrl: "/dashboard?upgrade=true",
      },
    }
  }
  return { ok: true }
}
