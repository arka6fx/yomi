import { Hono } from "hono"
import { db, usageEvents } from "@yomi/db"
import { authenticate } from "../auth.js"
import { expireCredits } from "../services/credit-ledger.js"
import { chargeUsage, lowCreditWarning, type ChargeKind } from "../services/metering.js"

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
  kind: ChargeKind
  duration?: number // voice duration in seconds
}

const VALID_KINDS: ChargeKind[] = ["chat", "voice", "analyze", "bot_message"]

function nextMonthReset(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

usageRouter.post("/interactions/reserve", authenticate, async (c) => {
  // Sweep expired credit grants before any balance check so stale credits never
  // count toward a user's available balance. Fire-and-forget; debits are idempotent.
  expireCredits().catch(() => {})

  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as ReserveBody
  const kind = body.kind

  if (!VALID_KINDS.includes(kind)) {
    return c.json({ error: `kind must be one of: ${VALID_KINDS.join(", ")}`, code: "invalid_usage_kind" }, 400)
  }

  // Credits are the single gate: owner bypass, active plan required, balance >= cost.
  const result = await chargeUsage({ user, kind, durationSeconds: body.duration })

  if (!result.ok) {
    return c.json(
      {
        error: result.message,
        code: result.code,
        plan: result.plan,
        upgradeUrl: result.code === "subscription_required" || result.code === "subscription_inactive"
          ? "/dashboard?upgrade=true"
          : "/dashboard?credits=true",
        resetAt: nextMonthReset(),
      },
      result.status,
    )
  }

  const resp: Record<string, unknown> = {
    ok: true,
    plan: result.plan,
    creditsRequired: result.creditsRequired,
    creditsCharged: result.creditsCharged,
    creditsRemaining: result.balance,
    paidBy: result.paidBy,
    resetAt: nextMonthReset(),
  }

  if (user.subscriptionStatus === "past_due") {
    resp["billingWarning"] = "Your payment is past due. Please update your payment method."
  }

  const warning = result.paidBy === "credits" ? lowCreditWarning(user, result.balance) : null
  if (warning) resp["usageWarning"] = warning

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
