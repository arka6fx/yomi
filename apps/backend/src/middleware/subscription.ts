import { and, eq, gt, sql } from "drizzle-orm"
import type { Context, Next } from "hono"
import { db } from "@yomi/db"
import * as authSchema from "../auth-schema.js"
import { effectivePlanForUser, isOwnerUser } from "../entitlements.js"

export type AccessKind = "chat" | "voice" | "agent"

const DAILY_LIMITS: Record<string, Record<AccessKind, number>> = {
  pro: { chat: 10000, voice: 200, agent: 0 },
}

const PAID_PLANS = new Set(Object.keys(DAILY_LIMITS))

function todayUtc(): string {
  return new Date().toISOString().split("T")[0]!
}

function trialActiveUntil(user: { trialEndDate: Date | null }): Date | null {
  return user.trialEndDate && new Date() < user.trialEndDate ? user.trialEndDate : null
}

function paidPlanActive(user: { subscriptionStatus: string }): boolean {
  return user.subscriptionStatus === "active"
}

function counterColumn(kind: AccessKind) {
  switch (kind) {
    case "chat": return authSchema.user.dailyChatCount
    case "voice": return authSchema.user.dailyVoiceCount
    case "agent": return authSchema.user.agentUsageCount
  }
}

function dailyCountSql(kind: AccessKind, activeKind: AccessKind, today: string) {
  const column = counterColumn(kind)
  if (kind === activeKind) {
    return sql<number>`case when ${authSchema.user.dailyResetDate} = ${today} then ${column} + 1 else 1 end`
  }
  return sql<number>`case when ${authSchema.user.dailyResetDate} = ${today} then ${column} else 0 end`
}

// Atomically reserves access before the expensive provider call starts.
export function requireAccess(kind: AccessKind) {
  return async (c: Context, next: Next) => {
    const user = c.get("user")
    const effectivePlan = effectivePlanForUser(user)

    if (isOwnerUser(user)) return next()

    if (effectivePlan === "max") {
      return c.json({ error: "Yomi Max is coming soon", code: "plan_unavailable" }, 403)
    }

    if (kind === "agent") {
      return c.json({ error: "Yomi Max required for agents", code: "upgrade_required" }, 403)
    }

    if (effectivePlan === "explore") {
      const trialEnd = trialActiveUntil(user)
      if (!trialEnd) {
        return c.json({ error: "Free trial expired - please upgrade", code: "trial_expired" }, 403)
      }

      const [reserved] = await db.update(authSchema.user)
        .set({ trialInteractionUsed: sql`${authSchema.user.trialInteractionUsed} + 1` })
        .where(and(
          eq(authSchema.user.id, user.id),
          eq(authSchema.user.plan, "explore"),
          gt(authSchema.user.trialEndDate, new Date()),
          sql`${authSchema.user.trialInteractionUsed} < ${authSchema.user.trialInteractionLimit}`,
        ))
        .returning({ id: authSchema.user.id })

      if (!reserved) {
        return c.json({ error: "Trial interaction limit reached - please upgrade", code: "interaction_limit_reached" }, 429)
      }

      return next()
    }

    if (!PAID_PLANS.has(effectivePlan)) {
      return c.json({ error: "Invalid subscription plan", code: "invalid_plan" }, 403)
    }

    if (!paidPlanActive(user)) {
      return c.json({ error: "Subscription required", code: "subscription_required" }, 403)
    }

    const limits = DAILY_LIMITS[effectivePlan]!
    const limit = limits[kind]
    const today = todayUtc()
    const countColumn = counterColumn(kind)

    const [reserved] = await db.update(authSchema.user)
      .set({
        dailyChatCount:  dailyCountSql("chat", kind, today),
        dailyVoiceCount: dailyCountSql("voice", kind, today),
        agentUsageCount: dailyCountSql("agent", kind, today),
        dailyResetDate:  today,
      })
      .where(and(
        eq(authSchema.user.id, user.id),
        eq(authSchema.user.plan, effectivePlan),
        eq(authSchema.user.subscriptionStatus, "active"),
        sql`(${authSchema.user.dailyResetDate} is null or ${authSchema.user.dailyResetDate} <> ${today} or ${countColumn} < ${limit})`,
      ))
      .returning({ id: authSchema.user.id })

    if (!reserved) {
      return c.json({ error: "Daily limit reached", code: "rate_limited" }, 429)
    }

    return next()
  }
}
