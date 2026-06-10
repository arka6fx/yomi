import { Hono } from "hono"
import { db, usageEvents } from "@yomi/db"
import { and, eq, gte, sql } from "drizzle-orm"
import { authenticate } from "../auth.js"
import {
  effectivePlanForUser,
  hasBillablePlanAccess,
  requestLimitForUser,
  featureLimitForUser,
  getPlanConfig,
  isOwnerUser,
} from "../entitlements.js"
import type { FeatureKey } from "@yomi/shared/plans"

export const usageRouter = new Hono()

type UsageEventBody = {
  kind: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  costCents?: number
  deviceId?: string
  metadata?: Record<string, unknown>
}

type ReserveBody = {
  kind: "chat" | "voice" | "screenshot" | "reasoning" | "desktop_automation" | "browser_automation" | "messaging"
  duration?: number  // voice duration in seconds
}

const FEATURE_KIND_MAP: Record<string, FeatureKey> = {
  chat: "chat",
  voice: "voiceMinutes",
  screenshot: "screenshots",
  reasoning: "reasoning",
  desktop_automation: "desktopAutomation",
  browser_automation: "browserAutomation",
  messaging: "gatewayMessages",
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

async function featureUsage(userId: string, kinds: string[], periodStart: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        gte(usageEvents.createdAt, periodStart),
        sql`${usageEvents.kind} = any(array[${kinds.map(k => sql.raw(`'${k}'`)).join(",")}])`,
      ),
    )
  return Number(row?.count ?? 0)
}

usageRouter.post("/interactions/reserve", authenticate, async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as ReserveBody
  const kind = body.kind

  const validKinds = Object.keys(FEATURE_KIND_MAP)
  if (!validKinds.includes(kind)) {
    return c.json({ error: `kind must be one of: ${validKinds.join(", ")}`, code: "invalid_usage_kind" }, 400)
  }

  const effectivePlan = effectivePlanForUser(user)

  if (!hasBillablePlanAccess(user)) {
    const status = user.subscriptionStatus ?? "inactive"
    const msg = status === "past_due"
      ? "Your payment is past due. Update your payment method to restore full access."
      : "Your subscription needs attention before Yomi can process more requests."
    return c.json(
      { error: msg, code: "subscription_inactive", plan: effectivePlan },
      402,
    )
  }

  const featureKey = FEATURE_KIND_MAP[kind]!
  const periodStart = currentMonthStart()

  // Feature-level quota enforcement
  if (!isOwnerUser(user)) {
    const featureLimit = featureLimitForUser(user, featureKey)
    if (featureLimit !== null) {
      const eventKinds = kind === "voice"
        ? ["request_voice"]
        : kind === "chat"
          ? ["request_chat"]
          : [kind]

      const used = await featureUsage(user.id, eventKinds, periodStart)
      if (used >= featureLimit) {
        const plan = getPlanConfig(user)
        return c.json(
          {
            error: `${plan.name} ${featureKey} limit (${featureLimit}) reached. Upgrade to continue.`,
            code: "quota_exceeded",
            plan: effectivePlan,
            feature: featureKey,
            used,
            limit: featureLimit,
            remaining: 0,
            resetAt: new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1)),
            upgradeUrl: "/dashboard?upgrade=true",
          },
          429,
        )
      }
    }
  }

  // Chat/voice requests — combined monthly limit
  if (kind === "chat" || kind === "voice") {
    const limit = requestLimitForUser(user)
    const used = await featureUsage(user.id, REQUEST_KINDS, periodStart)
    if (limit !== null && used >= limit) {
      return c.json(
        {
          error: "Monthly request limit reached. Upgrade or wait for the next reset.",
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
  }

  // Record usage event
  const eventKind = kind === "chat" ? "request_chat"
    : kind === "voice" ? "request_voice"
    : kind

  await db.insert(usageEvents).values({
    userId: user.id,
    kind: eventKind,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    costCents: body.duration ?? 0,
    status: "done",
  })

  const nextUsed = await featureUsage(user.id,
    kind === "chat" || kind === "voice" ? REQUEST_KINDS : [eventKind],
    periodStart,
  )

  const planConfig = getPlanConfig(user)
  const chatFeatureUsed = await featureUsage(user.id, REQUEST_KINDS, periodStart)

  const resp: Record<string, unknown> = {
    ok: true,
    plan: effectivePlan,
    feature: featureKey,
    featureUsed: nextUsed,
    featureLimit: featureLimitForUser(user, featureKey),
    featureRemaining: remaining(nextUsed, featureLimitForUser(user, featureKey)),
    requestsUsed: kind === "chat" || kind === "voice" ? chatFeatureUsed : undefined,
    requestsLimit: kind === "chat" || kind === "voice" ? requestLimitForUser(user) : undefined,
    requestsRemaining: kind === "chat" || kind === "voice" ? remaining(chatFeatureUsed, requestLimitForUser(user)) : undefined,
    resetAt: new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1)),
    planLimits: planConfig.limits,
  }

  if (user.subscriptionStatus === "past_due") {
    resp["billingWarning"] = "Your payment is past due. Please update your payment method."
  }

  // Usage warning at 80%
  if (!isOwnerUser(user)) {
    const fl = featureLimitForUser(user, featureKey)
    if (fl !== null && nextUsed >= Math.floor(fl * 0.8)) {
      resp["usageWarning"] = `You've used ${nextUsed} of ${fl} ${featureKey}.`
      if (nextUsed >= fl) {
        resp["upgradePrompt"] = true
      }
    }
  }

  return c.json(resp)
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
