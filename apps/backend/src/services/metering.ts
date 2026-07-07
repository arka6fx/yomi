import { db, usageEvents } from "@yomi/db"
import { eq } from "drizzle-orm"
import {
  effectivePlanForUser,
  hasBillablePlanAccess,
  isOwnerUser,
  getPlanConfig,
} from "../entitlements.js"
import { consumeCredits, getCreditSummary } from "./credit-ledger.js"
import { creditsForUsage, type BillableUsageKind } from "./credit-pricing.js"

// The four billable surfaces. Each maps to a credit cost (BillableUsageKind) and to
// the usageEvents.kind we persist for the dashboard breakdown.
export type ChargeKind = "chat" | "voice" | "analyze" | "bot_message"

const CREDIT_KIND: Record<ChargeKind, BillableUsageKind> = {
  chat: "chat",
  voice: "voice",
  analyze: "analyze",
  bot_message: "bot_message",
}

// What we store on usageEvents.kind — chat/voice become request_* to match the
// existing dashboard and transaction queries; the others pass through.
const EVENT_KIND: Record<ChargeKind, string> = {
  chat: "request_chat",
  voice: "request_voice",
  analyze: "analyze",
  bot_message: "bot_message",
}

type MeteringUser = {
  id: string
  email?: string | null
  role?: string | null
  plan?: string | null
  subscriptionStatus?: string | null
  currentPeriodEnd?: Date | null
  trialEndDate?: Date | null
}

export type ChargeSuccess = {
  ok: true
  plan: string
  creditsRequired: number
  creditsCharged: number
  balance: number
  usageEventId: string | null
  paidBy: "credits" | "owner"
}

export type ChargeFailure = {
  ok: false
  status: 402 | 403
  code: "subscription_inactive" | "subscription_required" | "credits_exhausted"
  message: string
  plan: string
}

export type ChargeResult = ChargeSuccess | ChargeFailure

function nextMonthResetLabel(): string {
  const now = new Date()
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return reset.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })
}

// Single chokepoint for charging a billable action. Credits are the only gate:
// owners bypass, an active plan is required, and the action proceeds only when the
// credit balance covers the cost — then exactly one usage event is recorded and the
// credits are consumed. Callers must not do paid work before this returns ok.
export async function chargeUsage(input: {
  user: MeteringUser
  kind: ChargeKind
  durationSeconds?: number
  metadata?: Record<string, unknown>
}): Promise<ChargeResult> {
  const { user, kind } = input
  const plan = effectivePlanForUser(user)

  // Owners: record the event for analytics, never charge or block.
  if (isOwnerUser(user)) {
    const [event] = await db
      .insert(usageEvents)
      .values({
        userId: user.id,
        kind: EVENT_KIND[kind],
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        creditsCharged: 0,
        status: "done",
        metadata: { reserveKind: kind, ...(input.metadata ?? {}) },
      })
      .returning({ id: usageEvents.id })
      .catch(() => [])
    return {
      ok: true,
      plan,
      creditsRequired: 0,
      creditsCharged: 0,
      balance: Number.POSITIVE_INFINITY,
      usageEventId: event?.id ?? null,
      paidBy: "owner",
    }
  }

  // Plan must be active (explore trial not expired, or paid sub active / in grace).
  if (!hasBillablePlanAccess(user)) {
    const status = user.subscriptionStatus ?? "inactive"
    const message =
      status === "past_due"
        ? "Payment didn't go through — Yomi is paused. Update your payment method in the dashboard."
        : status === "inactive" && plan === "explore"
          ? "Your 30-day free trial has ended. Subscribe to Pro or Max to keep using Yomi."
          : "Subscription isn't active. Head to the dashboard to sort it out."
    return { ok: false, status: 402, code: "subscription_inactive", message, plan }
  }

  const creditsRequired = creditsForUsage(CREDIT_KIND[kind], {
    durationSeconds: input.durationSeconds,
  })
  const summary = await getCreditSummary(user.id)

  // Out of credits — credits are the only gate, so block here.
  if (summary.balance < creditsRequired) {
    if (plan === "explore") {
      return {
        ok: false,
        status: 402,
        code: "subscription_required",
        message: "You're out of trial credits. Subscribe to Pro or Max to keep using Yomi.",
        plan,
      }
    }
    return {
      ok: false,
      status: 402,
      code: "credits_exhausted",
      message: `You're out of credits. Buy a credit pack to continue. Resets ${nextMonthResetLabel()}.`,
      plan,
    }
  }

  // Record the usage event, then consume credits against it.
  const [event] = await db
    .insert(usageEvents)
    .values({
      userId: user.id,
      kind: EVENT_KIND[kind],
      inputTokens: 0,
      outputTokens: 0,
      costCents: input.durationSeconds ?? 0,
      creditsCharged: 0,
      status: "done",
      metadata: { reserveKind: kind, ...(input.metadata ?? {}) },
    })
    .returning({ id: usageEvents.id })

  if (!event) {
    // Could not record the event — fail closed rather than do unmetered work.
    console.error(`[metering] usage event insert returned no row user=${user.id} kind=${kind}`)
    return {
      ok: false,
      status: 402,
      code: "credits_exhausted",
      message: "Couldn't record usage. Please try again.",
      plan,
    }
  }

  const debit = await consumeCredits({
    userId: user.id,
    amount: creditsRequired,
    usageEventId: event.id,
    idempotencyKey: `usage:${event.id}:consume`,
    reason: `${kind} usage`,
    metadata: { kind, ...(input.metadata ?? {}) },
  })

  if (!debit.ok) {
    // Balance moved under us between the check and the debit (race). Block.
    return {
      ok: false,
      status: 402,
      code: plan === "explore" ? "subscription_required" : "credits_exhausted",
      message:
        plan === "explore"
          ? "You're out of trial credits. Subscribe to Pro or Max to keep using Yomi."
          : `You're out of credits. Buy a credit pack to continue. Resets ${nextMonthResetLabel()}.`,
      plan,
    }
  }

  await db
    .update(usageEvents)
    .set({ creditsCharged: debit.charged })
    .where(eq(usageEvents.id, event.id))

  return {
    ok: true,
    plan,
    creditsRequired,
    creditsCharged: debit.charged,
    balance: debit.balance,
    usageEventId: event.id,
    paidBy: "credits",
  }
}

// Low-credit nudge: surfaced once remaining credits drop below 20% of the plan's
// monthly allotment. Returns null when there's nothing to warn about.
export function lowCreditWarning(user: MeteringUser, balance: number): string | null {
  if (isOwnerUser(user)) return null
  const included = getPlanConfig(user).includedCredits
  if (included <= 0) return null
  if (balance > included * 0.2) return null
  return `You have ${balance} credits left.`
}
