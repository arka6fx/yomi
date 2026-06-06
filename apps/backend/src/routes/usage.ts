import { Hono } from "hono"
import { db, usageEvents } from "@yomi/db"
import { and, eq, gte, sql } from "drizzle-orm"
import { authenticate } from "../auth.js"
import {
  effectivePlanForUser,
  hasBillablePlanAccess,
  requestLimitForUser,
} from "../entitlements.js"

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

const REQUEST_KINDS = ["request_chat", "request_voice"]

function remaining(used: number, limit: number | null): number | null {
  if (limit === null) return null
  return Math.max(limit - used, 0)
}

function currentMonthStart(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

async function requestUsage(userId: string, periodStart: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        gte(usageEvents.createdAt, periodStart),
        sql`${usageEvents.kind} in ${REQUEST_KINDS}`,
      ),
    )
  return Number(row?.count ?? 0)
}

usageRouter.post("/interactions/reserve", authenticate, async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as ReserveInteractionBody
  const kind = body.kind
  if (kind !== "chat" && kind !== "voice") {
    return c.json({ error: "kind must be chat or voice", code: "invalid_usage_kind" }, 400)
  }

  const effectivePlan = effectivePlanForUser(user)
  if (!hasBillablePlanAccess(user)) {
    return c.json(
      {
        error: "Your subscription needs attention before Yomi can process more requests.",
        code: "subscription_inactive",
        plan: effectivePlan,
      },
      402,
    )
  }

  const limit = requestLimitForUser(user)
  const periodStart = currentMonthStart()
  const used = await requestUsage(user.id, periodStart)

  if (limit !== null && used >= limit) {
    return c.json(
      {
        error: "You have used all requests for this month. Upgrade or wait for the next reset.",
        code: "quota_exceeded",
        plan: effectivePlan,
        requestsUsed: used,
        requestsLimit: limit,
        requestsRemaining: 0,
        resetAt: new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1)),
      },
      429,
    )
  }

  await db.insert(usageEvents).values({
    userId: user.id,
    kind: `request_${kind}`,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    status: "done",
  })

  const nextUsed = used + 1

  return c.json({
    ok: true,
    plan: effectivePlan,
    requestsUsed: nextUsed,
    requestsLimit: limit,
    requestsRemaining: remaining(nextUsed, limit),
    resetAt: new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1)),
    dailyChatUsed: user.dailyChatCount,
    dailyVoiceUsed: user.dailyVoiceCount,
  })
})

usageRouter.post("/", authenticate, async (c) => {
  const body = (await c.req.json()) as UsageEventBody
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
