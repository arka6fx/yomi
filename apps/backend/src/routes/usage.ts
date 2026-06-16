import { Hono } from "hono"
import { db, usageEvents } from "@yomi/db"
import { and, eq, gte, inArray, sql } from "drizzle-orm"
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
import { consumeCredits, getCreditSummary, expireCredits } from "../services/credit-ledger.js"
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
  kind: "chat" | "voice" | "analyze" | "bot_message"
  duration?: number  // voice duration in seconds
}

const FEATURE_KIND_MAP: Record<string, FeatureKey> = {
  chat: "chat",
  voice: "voiceMinutes",
  analyze: "analyze",
  bot_message: "botMessages",
}

const CREDIT_KIND_MAP: Record<ReserveBody["kind"], BillableUsageKind> = {
  chat: "chat",
  voice: "voice",
  analyze: "analyze",
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
        inArray(usageEvents.kind, kinds),
      ),
    )
  return Number(row?.count ?? 0)
}

usageRouter.post("/interactions/reserve", authenticate, async (c) => {
  // Sweep expired credit grants before any balance check so stale credits
  // never count toward a user's available balance. Fire-and-forget per-request;
  // the debitCredits inside is idempotent so concurrent sweeps are safe.
  expireCredits().catch(() => {})

  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as ReserveBody
  const kind = body.kind

  console.warn(`[usage/reserve] kind=${kind} user=${user?.email} plan=${user?.plan} subStatus=${user?.subscriptionStatus}`)

  const validKinds = Object.keys(FEATURE_KIND_MAP)
  if (!validKinds.includes(kind)) {
    return c.json({ error: `kind must be one of: ${validKinds.join(", ")}`, code: "invalid_usage_kind" }, 400)
  }

  const effectivePlan = effectivePlanForUser(user)

  if (!hasBillablePlanAccess(user)) {
    const status = user.subscriptionStatus ?? "inactive"
    const msg = status === "past_due"
      ? "Payment didn't go through — Yomi is paused. Update your payment method in the dashboard."
      : status === "inactive" && effectivePlan === "explore"
        ? "Your 30-day free trial has ended. Upgrade to Pro to keep using Yomi."
        : "Subscription isn't active. Head to the dashboard to sort it out."
    return c.json(
      { error: msg, code: "subscription_inactive", plan: effectivePlan },
      402,
    )
  }

  const featureKey = FEATURE_KIND_MAP[kind]!
  const periodStart = currentMonthStart()
  const nextReset = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1))
  const resetDay = nextReset.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })
  const creditKind = CREDIT_KIND_MAP[kind]
  const creditsRequired = creditsForUsage(creditKind, { durationSeconds: body.duration })
  let featureUsed = 0
  let requestsUsedBefore = 0

  const FEATURE_LABEL: Record<string, string> = {
    chat: "chat",
    voiceMinutes: "voice",
    analyze: "screen analyze",
    botMessages: "bot messages",
    connectors: "connectors",
  }

// Feature-level quota enforcement
  if (!isOwnerUser(user)) {
    const featureLimit = featureLimitForUser(user, featureKey)
    if (featureLimit !== null) {
      if (featureLimit === 0) {
        const plan = getPlanConfig(user)
        const label = FEATURE_LABEL[featureKey] ?? featureKey
        return c.json(
          {
            error: `${label.charAt(0).toUpperCase() + label.slice(1)} isn't on your ${plan.name} plan. Upgrade to unlock it.`,
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
        const creditsBefore = await getCreditSummary(user.id)
        if (creditsBefore.balance < creditsRequired) {
          const plan = getPlanConfig(user)
          const label = FEATURE_LABEL[featureKey] ?? featureKey
          return c.json(
            {
              error: `You've hit your ${label} limit for ${plan.name}.${plan.key !== "explore" ? ` Resets ${resetDay}.` : ""}`,
              code: "feature_quota_exceeded",
              plan: effectivePlan,
              feature: featureKey,
              used: featureUsed,
              limit: featureLimit,
              upgradeUrl: "/dashboard?upgrade=true",
              resetAt: nextReset,
            },
            402,
          )
        }
      }
    }
  }

  // Chat/voice requests — combined monthly limit
  if (kind === "chat" || kind === "voice") {
    const limit = requestLimitForUser(user)
    requestsUsedBefore = await featureUsage(user.id, REQUEST_KINDS, periodStart)
    if (limit !== null && requestsUsedBefore >= limit) {
      const creditsSummary = await getCreditSummary(user.id)
      if (creditsSummary.balance < creditsRequired) {
        const plan = getPlanConfig(user)
        return c.json(
          {
            error: `You've hit your request limit for ${plan.name}.${plan.key !== "explore" ? ` Resets ${resetDay}.` : ""}`,
            code: "request_quota_exceeded",
            plan: effectivePlan,
            feature: "chat",
            used: requestsUsedBefore,
            limit,
            upgradeUrl: "/dashboard?credits=true",
            resetAt: nextReset,
          },
          402,
        )
      }
    }
  }

  const creditsBefore = await getCreditSummary(user.id)

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

  // Consume credits for non-owner users who have a positive credit balance
  if (!isOwnerUser(user) && creditsBefore.balance >= creditsRequired && event) {
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
