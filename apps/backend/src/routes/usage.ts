import { Hono } from "hono"
import { db, usageEvents } from "@yomi/db"
import { and, eq } from "drizzle-orm"
import { authenticate } from "../auth.js"
import { creditRenewal } from "../entitlements.js"
import { recordAiUsage } from "../services/ai-telemetry.js"
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

type FinalizeTelemetryBody = {
  requestId?: string
  endpoint?: string
  surface?: string
  route?: string
  intent?: string
  firstTokenLatencyMs?: number
  latencyMs?: number
  toolCalls?: number
  connectorIds?: string[]
  visionImages?: number
  ttsChars?: number
  sttAudioSeconds?: number
  maxOutputTokens?: number
}

type FinalizeBody = {
  usageEventId?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  costCents?: number
  status?: "done" | "error" | "cancelled"
  metadata?: Record<string, unknown>
  telemetry?: FinalizeTelemetryBody
}

const VALID_KINDS: ChargeKind[] = ["chat", "voice", "analyze", "bot_message", "agent"]

usageRouter.post("/interactions/reserve", authenticate, async (c) => {
  // Sweep expired credit grants before any balance check so stale credits never
  // count toward a user's available balance. Fire-and-forget; debits are idempotent.
  expireCredits().catch(() => {})

  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as ReserveBody
  const kind = body.kind

  if (!VALID_KINDS.includes(kind)) {
    return c.json(
      { error: `kind must be one of: ${VALID_KINDS.join(", ")}`, code: "invalid_usage_kind" },
      400,
    )
  }

  // Credits are the single gate: owner bypass, active plan required, balance >= cost.
  const result = await chargeUsage({ user, kind, durationSeconds: body.duration })

  if (!result.ok) {
    return c.json(
      {
        error: result.message,
        code: result.code,
        plan: result.plan,
        upgradeUrl:
          result.code === "subscription_required" || result.code === "subscription_inactive"
            ? "/dashboard?upgrade=true"
            : "/dashboard?credits=true",
        resetAt: creditRenewal(user).at,
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
    resetAt: creditRenewal(user).at,
    usageEventId: result.usageEventId,
  }

  if (user.subscriptionStatus === "past_due") {
    resp["billingWarning"] = "Your payment is past due. Please update your payment method."
  }

  const warning = result.paidBy === "credits" ? lowCreditWarning(user, result.balance) : null
  if (warning) resp["usageWarning"] = warning

  return c.json(resp)
})

usageRouter.post("/interactions/finalize", authenticate, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as FinalizeBody
  const user = c.get("user")
  const usageEventId = body.usageEventId

  if (!usageEventId) {
    return c.json({ error: "usageEventId is required", code: "invalid_usage_event" }, 400)
  }

  const inputTokens = Math.max(0, Math.floor(body.inputTokens ?? 0))
  const outputTokens = Math.max(0, Math.floor(body.outputTokens ?? 0))
  const costCents = Math.max(0, Math.floor(body.costCents ?? 0))

  await db
    .update(usageEvents)
    .set({
      model: body.model ?? null,
      inputTokens,
      outputTokens,
      costCents,
      status: body.status ?? "done",
      metadata: body.metadata ?? null,
    })
    .where(and(eq(usageEvents.id, usageEventId), eq(usageEvents.userId, user.id)))

  const t = body.telemetry
  if (t?.requestId && t.endpoint && t.surface) {
    await recordAiUsage({
      userId: user.id,
      requestId: t.requestId,
      usageEventId,
      endpoint: t.endpoint,
      surface: t.surface,
      route: t.route ?? null,
      intent: t.intent ?? null,
      model: body.model ?? null,
      inputTokens,
      outputTokens,
      totalApiCostMicros: costCents * 10_000,
      toolCalls: t.toolCalls,
      connectorIds: t.connectorIds,
      visionImages: t.visionImages,
      ttsChars: t.ttsChars,
      sttAudioSeconds: t.sttAudioSeconds,
      maxOutputTokens: t.maxOutputTokens,
      latencyMs: t.latencyMs,
      firstTokenLatencyMs: t.firstTokenLatencyMs ?? null,
      status:
        body.status === "error" ? "error" : body.status === "cancelled" ? "cancelled" : "done",
      metadata: body.metadata,
    })
  }

  return c.json({ ok: true })
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
