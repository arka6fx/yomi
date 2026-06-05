import { Hono } from "hono"
import { db, usageEvents } from "@yomi/db"
import { authenticate } from "../auth.js"
import { effectivePlanForUser } from "../entitlements.js"

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

function trialRemaining(used: number, limit: number): number {
  return Math.max(limit - used, 0)
}

usageRouter.post("/interactions/reserve", authenticate, async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as ReserveInteractionBody
  const kind = body.kind
  if (kind !== "chat" && kind !== "voice") {
    return c.json({ error: "kind must be chat or voice", code: "invalid_usage_kind" }, 400)
  }

  const effectivePlan = effectivePlanForUser(user)

  // Local testing mode: allow all plans without consuming quota.
  return c.json({
    ok: true,
    plan: effectivePlan,
    trialInteractionUsed: user.trialInteractionUsed,
    trialInteractionLimit: user.trialInteractionLimit,
    trialInteractionsRemaining: trialRemaining(user.trialInteractionUsed, user.trialInteractionLimit),
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
