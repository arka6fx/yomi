import { Hono } from "hono"
import { db, usageEvents } from "@yomi/db"
import { and, eq, gt, sql } from "drizzle-orm"
import { authenticate } from "../auth.js"
import * as authSchema from "../auth-schema.js"

export const usageRouter = new Hono()

type ReserveKind = "chat" | "voice"

type UsageEventBody = {
  kind: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  costCents?: number
  deviceId?: string
}

type ReserveInteractionBody = {
  kind?: ReserveKind
}

const DAILY_LIMITS: Record<string, Record<ReserveKind, number>> = {
  pro: { chat: 10000, voice: 200 },
}

const PAID_PLANS = new Set(Object.keys(DAILY_LIMITS))

function trialActiveUntil(user: { trialEndDate: Date | null }): Date | null {
  return user.trialEndDate && new Date() < user.trialEndDate ? user.trialEndDate : null
}

function paidPlanActive(user: { subscriptionStatus: string }): boolean {
  return user.subscriptionStatus === "active"
}

function todayUtc(): string {
  return new Date().toISOString().split("T")[0]!
}

function counterColumn(kind: ReserveKind) {
  return kind === "chat" ? authSchema.user.dailyChatCount : authSchema.user.dailyVoiceCount
}

function dailyCountSql(kind: ReserveKind, activeKind: ReserveKind, today: string) {
  const column = counterColumn(kind)
  if (kind === activeKind) {
    return sql<number>`case when ${authSchema.user.dailyResetDate} = ${today} then ${column} + 1 else 1 end`
  }
  return sql<number>`case when ${authSchema.user.dailyResetDate} = ${today} then ${column} else 0 end`
}

usageRouter.post("/interactions/reserve", authenticate, async (c) => {
  const user = c.get("user")
  const body = await c.req.json().catch(() => ({})) as ReserveInteractionBody
  const kind = body.kind
  if (kind !== "chat" && kind !== "voice") {
    return c.json({ error: "kind must be chat or voice", code: "invalid_usage_kind" }, 400)
  }

  if (user.role === "owner") {
    return c.json({
      ok: true,
      plan: user.plan,
      trialInteractionUsed: user.trialInteractionUsed,
      trialInteractionLimit: user.trialInteractionLimit,
    })
  }

  if (user.plan !== "explore") {
    if (user.plan === "max") {
      return c.json({ error: "Yomi Max is coming soon", code: "plan_unavailable" }, 403)
    }

    if (!PAID_PLANS.has(user.plan)) {
      return c.json({ error: "Invalid subscription plan", code: "invalid_plan" }, 403)
    }

    if (!paidPlanActive(user)) {
      return c.json({ error: "Subscription required", code: "subscription_required" }, 403)
    }

    const limits = DAILY_LIMITS[user.plan]!
    const limit = limits[kind]
    const today = todayUtc()
    const countColumn = counterColumn(kind)

    const [reserved] = await db.update(authSchema.user)
      .set({
        dailyChatCount:  dailyCountSql("chat", kind, today),
        dailyVoiceCount: dailyCountSql("voice", kind, today),
        dailyResetDate:  today,
      })
      .where(and(
        eq(authSchema.user.id, user.id),
        eq(authSchema.user.plan, user.plan),
        eq(authSchema.user.subscriptionStatus, "active"),
        sql`(${authSchema.user.dailyResetDate} is null or ${authSchema.user.dailyResetDate} <> ${today} or ${countColumn} < ${limit})`,
      ))
      .returning({
        plan: authSchema.user.plan,
        trialInteractionUsed: authSchema.user.trialInteractionUsed,
        trialInteractionLimit: authSchema.user.trialInteractionLimit,
        dailyChatUsed: authSchema.user.dailyChatCount,
        dailyVoiceUsed: authSchema.user.dailyVoiceCount,
      })

    if (!reserved) {
      return c.json({ error: "Daily limit reached", code: "rate_limited" }, 429)
    }

    return c.json({ ok: true, ...reserved })
  }

  const trialEnd = trialActiveUntil(user)
  if (!trialEnd) {
    return c.json({ error: "Free trial expired - please upgrade", code: "trial_expired" }, 403)
  }

  // Reserve exactly one Explore turn. The WHERE clause makes the cap atomic.
  const [reserved] = await db.update(authSchema.user)
    .set({ trialInteractionUsed: sql`${authSchema.user.trialInteractionUsed} + 1` })
    .where(and(
      eq(authSchema.user.id, user.id),
      eq(authSchema.user.plan, "explore"),
      gt(authSchema.user.trialEndDate, new Date()),
      sql`${authSchema.user.trialInteractionUsed} < ${authSchema.user.trialInteractionLimit}`,
    ))
    .returning({
      plan: authSchema.user.plan,
      trialInteractionUsed: authSchema.user.trialInteractionUsed,
      trialInteractionLimit: authSchema.user.trialInteractionLimit,
    })

  if (!reserved) {
    return c.json({ error: "Trial interaction limit reached - please upgrade", code: "interaction_limit_reached" }, 429)
  }

  return c.json({ ok: true, ...reserved })
})

usageRouter.post("/", authenticate, async (c) => {
  const body = await c.req.json() as UsageEventBody
  const user = c.get("user")

  await db.insert(usageEvents).values({
    userId: user.id,
    deviceId: body.deviceId ?? null,
    kind: body.kind,
    model: body.model ?? null,
    inputTokens: body.inputTokens ?? 0,
    outputTokens: body.outputTokens ?? 0,
    costCents: body.costCents ?? 0,
    status: "done",
  })

  return c.json({ ok: true })
})
