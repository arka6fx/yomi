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
import { consumeCredits, getCreditSummary } from "../services/credit-ledger.js"
import { creditsForUsage, type BillableUsageKind } from "../services/credit-pricing.js"

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
  kind: "chat" | "voice" | "screenshot" | "reasoning" | "bot_message"
  duration?: number  // voice duration in seconds
}

const FEATURE_KIND_MAP: Record<string, FeatureKey> = {
  chat: "chat",
  voice: "voiceMinutes",
  screenshot: "screenshots",
  reasoning: "reasoning",
  bot_message: "botMessages",
}

const CREDIT_KIND_MAP: Record<ReserveBody["kind"], BillableUsageKind> = {
  chat: "chat",
  voice: "voice",
  screenshot: "screenshot",
  reasoning: "reasoning",
  bot_message: "bot_message",
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
  const creditKind = CREDIT_KIND_MAP[kind]
  const creditsRequired = creditsForUsage(creditKind, { durationSeconds: body.duration })
  let featureUsed = 0
  let requestsUsedBefore = 0

  // Feature-level quota enforcement
  if (!isOwnerUser(user)) {
    const featureLimit = featureLimitForUser(user, featureKey)
    if (featureLimit !== null) {
      if (featureLimit === 0) {
        const plan = getPlanConfig(user)
        return c.json(
          {
            error: `${plan.name} does not include ${featureKey}. Upgrade to access this feature.`,
            code: "feature_not_available",
            plan: effectivePlan,
            feature: featureKey,
            upgradeUrl: "/dashboard?upgrade=true",
          },
          403,
        )
      }

      const eventKinds = kind === "voice"
        ? ["request_voice"]
        : kind === "chat"
          ? ["request_chat"]
          : [kind]

      featureUsed = await featureUsage(user.id, eventKinds, periodStart)
      if (featureUsed >= featureLimit) {
        const plan = getPlanConfig(user)
        return c.json(
          {
            error: `${plan.name} monthly ${featureKey} limit reached. Upgrade to continue.`,
            code: "feature_quota_exceeded",
            plan: effectivePlan,
            feature: featureKey,
            used: featureUsed,
            limit: featureLimit,
            upgradeUrl: "/dashboard?upgrade=true",
            resetAt: new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1)),
          },
          402,
        )
      }
    }
  }

  // Chat/voice requests — combined monthly limit
  if (kind === "chat" || kind === "voice") {
    const limit = requestLimitForUser(user)
    requestsUsedBefore = await featureUsage(user.id, REQUEST_KINDS, periodStart)
    if (limit !== null && requestsUsedBefore >= limit) {
      const plan = getPlanConfig(user)
      return c.json(
        {
          error: `${plan.name} monthly request limit reached. Buy credits or upgrade to continue.`,
          code: "request_quota_exceeded",
          plan: effectivePlan,
          used: requestsUsedBefore,
          limit,
          upgradeUrl: "/dashboard?credits=true",
          resetAt: new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1)),
        },
        402,
      )
    }
  }

  const creditsBefore = await getCreditSummary(user.id)
  const requiresCredits = creditsBefore.balance >= creditsRequired

  // Record usage event
  const eventKind = kind === "chat" ? "request_chat"
    : kind === "voice" ? "request_voice"
    : kind

  const [event] = await db.insert(usageEvents).values({
    userId: user.id,
    kind: eventKind,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    costCents: body.duration ?? 0,
    creditsCharged: 0,
    status: "done",
    metadata: { reserveKind: kind },
  }).returning({ id: usageEvents.id })

  let creditsCharged = 0
  let creditsRemaining = creditsBefore.balance
  let paidBy = "legacy_quota"

  if (!isOwnerUser(user) && requiresCredits && event) {
    const debit = await consumeCredits({
      userId: user.id,
      amount: creditsRequired,
      usageEventId: event.id,
      idempotencyKey: `usage:${event.id}:consume`,
      reason: `${kind} usage`,
      metadata: { kind, feature: featureKey },
    })

    if (!debit.ok) {
      // credits insufficient — usage recorded but not charged; will be flagged via usageWarning
    } else {
      creditsCharged = debit.charged
      creditsRemaining = debit.balance
      paidBy = "credits"
      await db
        .update(usageEvents)
        .set({ creditsCharged })
        .where(eq(usageEvents.id, event.id))
    }
  } else if (isOwnerUser(user)) {
    paidBy = "owner_bypass"
  }

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
    creditsRequired,
    creditsCharged,
    creditsRemaining,
    paidBy,
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
