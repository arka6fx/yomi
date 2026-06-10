import { Hono } from "hono"
import { createHmac } from "node:crypto"
import { db, usageEvents } from "@yomi/db"
import { eq, and, gte, sql, inArray } from "drizzle-orm"
import { authenticate } from "../auth.js"
import * as authSchema from "../auth-schema.js"
import { effectivePlanForUser, effectiveRoleForUser, requestLimitForUser, featureLimitForUser } from "../entitlements.js"
import { PLANS as SHARED_PLANS, type PlanKey, type FeatureKey } from "@yomi/shared/plans"

const RAZORPAY_PLAN_IDS: Partial<Record<PlanKey, string | null>> = {
  explore: null,
  pro: process.env["RAZORPAY_PLAN_PRO"] ?? null,
  max: process.env["RAZORPAY_PLAN_MAX"] ?? null,
}

function planFeatures(key: string): string[] {
  const plan = SHARED_PLANS[key]
  if (!plan) return []
  const l = plan.limits
  return [
    `${l.chat.toLocaleString()} AI chats / month`,
    `${l.voiceMinutes} min voice`,
    l.reasoning > 0 ? `${l.reasoning} reasoning` : "",
    l.desktopAutomation > 0 ? `${l.desktopAutomation} desktop runs` : "",
    l.browserAutomation > 0 ? `${l.browserAutomation} browser runs` : "",
    l.gatewayMessages > 0 ? `${l.gatewayMessages} messaging` : "",
  ].filter(Boolean)
}

// ── Currency Display Layer ─────────────────────────────────────────────────────
// Maps USD cents to estimated local amounts. Updated manually until we
// integrate a live FX API (post-500-customers).

interface CurrencyDisplay {
  code: string       // ISO 4217
  symbol: string     // "$", "₹", "€", etc.
  rate: number       // 1 USD = X local units
  decimals: number   // display precision
}

const CURRENCIES: Record<string, CurrencyDisplay> = {
  usd: { code: "USD", symbol: "$", rate: 1, decimals: 2 },
  inr: { code: "INR", symbol: "₹", rate: 83, decimals: 0 },
  eur: { code: "EUR", symbol: "€", rate: 0.92, decimals: 2 },
  gbp: { code: "GBP", symbol: "£", rate: 0.79, decimals: 2 },
  aud: { code: "AUD", symbol: "A$", rate: 1.52, decimals: 2 },
  cad: { code: "CAD", symbol: "C$", rate: 1.36, decimals: 2 },
  brl: { code: "BRL", symbol: "R$", rate: 5.05, decimals: 2 },
  jpy: { code: "JPY", symbol: "¥", rate: 149, decimals: 0 },
}

// Country → currency mapping (alpha-2 → default currency for display)
const COUNTRY_CURRENCY: Record<string, string> = {
  IN: "inr", US: "usd", GB: "gbp", CA: "cad", AU: "aud",
  BR: "brl", JP: "jpy", DE: "eur", FR: "eur", IT: "eur",
  ES: "eur", NL: "eur", SE: "eur", MX: "usd", PH: "usd",
  NG: "usd", ZA: "usd", AE: "usd", SG: "usd", HK: "usd",
  // default: usd
}

function detectCurrency(cfCountry: string | null): CurrencyDisplay {
  const key = cfCountry ? (COUNTRY_CURRENCY[cfCountry.toUpperCase()] ?? "usd") : "usd"
  return CURRENCIES[key] ?? CURRENCIES["usd"]!
}

function estimateLocal(amountCents: number, display: CurrencyDisplay): {
  amount: number
  formatted: string
} {
  if (display.code === "USD") {
    return { amount: amountCents / 100, formatted: `$${(amountCents / 100).toFixed(2)}` }
  }
  const converted = Math.round(amountCents / 100 * display.rate)
  const divisor = Math.pow(10, display.decimals)
  const displayAmount = converted / divisor
  return {
    amount: displayAmount,
    formatted: `${display.symbol}${displayAmount.toLocaleString("en-US", {
      minimumFractionDigits: display.decimals,
      maximumFractionDigits: display.decimals,
    })}`,
  }
}

// ── Razorpay Helpers ───────────────────────────────────────────────────────────

function rzpAuth(): string {
  const id = process.env["RAZORPAY_KEY_ID"]
  const secret = process.env["RAZORPAY_KEY_SECRET"]
  if (!id || !secret) throw new Error("Razorpay credentials not configured")
  return "Basic " + btoa(`${id}:${secret}`)
}

async function rzp<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: { Authorization: rzpAuth(), "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Razorpay ${path} → ${res.status}: ${text}`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Razorpay ${path} returned non-JSON: ${text.slice(0, 200)}`)
  }
}

// ── Processed webhook event IDs (in-memory, capped) ────────────────────────────
const processedWebhookIds = new Set<string>()
const MAX_WEBHOOK_IDS = 10_000

function isWebhookDuplicate(eventId: string): boolean {
  if (processedWebhookIds.has(eventId)) return true
  processedWebhookIds.add(eventId)
  if (processedWebhookIds.size > MAX_WEBHOOK_IDS) {
    const iter = processedWebhookIds.values().next()
    if (!iter.done) processedWebhookIds.delete(iter.value)
  }
  return false
}

// ── Router ─────────────────────────────────────────────────────────────────────

export const billingRouter = new Hono()

// Get public plan list with estimated local pricing
billingRouter.get("/plans", (c) => {
  const cf = c.req.header("CF-IPCountry") ?? null
  const display = detectCurrency(cf)

  const estimate =
    display.code === "USD" ? null
    : `Estimated ${display.code} equivalent. Charged in USD. Your bank may convert the amount automatically.`

  const plans = Object.values(SHARED_PLANS).map((p) => ({
    key: p.key,
    name: p.name,
    amountCents: p.priceCents,
    currency: "USD",
    interval: "month",
    features: planFeatures(p.key),
    local: p.priceCents > 0 ? estimateLocal(p.priceCents, display) : null,
    notice: estimate,
  }))

  return c.json({ plans, displayCurrency: display.code })
})

// Create Razorpay subscription — uses pre-created plan IDs from env
billingRouter.post("/create-subscription", authenticate, async (c) => {
  const { plan } = (await c.req.json()) as { plan: string }
  const user = c.get("user")

  const config = SHARED_PLANS[plan]
  if (!config || plan === "explore") {
    return c.json({ error: "Invalid plan" }, 400)
  }

  const planId = RAZORPAY_PLAN_IDS[plan as PlanKey]
  if (!planId) {
    return c.json({ error: "Razorpay plan not configured for this tier" }, 500)
  }

  // Idempotency: if user already has an active sub for this plan, return existing
  if (user.razorpaySubId && user.plan === plan && user.subscriptionStatus === "active") {
    return c.json({ error: "You already have an active subscription for this plan" }, 409)
  }

  try {
    // Create or reuse Razorpay customer
    let customerId = user.razorpayCustomerId ?? ""
    if (!customerId) {
      const customer = await rzp<{ id: string }>("/customers", {
        name: user.name,
        email: user.email,
        contact: "",
      })
      customerId = customer.id
      await db
        .update(authSchema.user)
        .set({ razorpayCustomerId: customerId })
        .where(eq(authSchema.user.id, user.id))
    }

    // Create subscription referencing the pre-created plan
    // total_count: 0 → indefinite (no auto-cancel after N cycles)
    const subscription = await rzp<{ id: string; short_url: string }>("/subscriptions", {
      plan_id: planId,
      customer_notify: 1,
      total_count: 0,
      notes: { userId: user.id, plan },
    })

    return c.json({ id: subscription.id, short_url: subscription.short_url })
  } catch (err) {
    console.error("[yomi/billing] create-subscription failed:", err)
    const message = err instanceof Error ? err.message : "Unknown error"
    return c.json({ error: message }, 502)
  }
})

// Cancel subscription (sets cancel_at_cycle_end = 1 in Razorpay)
billingRouter.post("/cancel-subscription", authenticate, async (c) => {
  const user = c.get("user")
  if (!user.razorpaySubId) {
    return c.json({ error: "No active subscription" }, 404)
  }
  try {
    await rzp(`/subscriptions/${user.razorpaySubId}/cancel`, { cancel_at_cycle_end: 1 })
    // Razorpay sends subscription.cancelled webhook — we update DB there
    return c.json({ ok: true })
  } catch (err) {
    console.error("[yomi/billing] cancel-subscription failed:", err)
    return c.json({ error: "Failed to cancel subscription" }, 502)
  }
})

// Razorpay webhook — verify signature, deduplicate, handle events
billingRouter.post("/webhook", async (c) => {
  const secret = process.env["RAZORPAY_WEBHOOK_SECRET"]
  const sig = c.req.header("x-razorpay-signature")
  if (!sig || !secret) return c.json({ error: "No signature" }, 400)

  const body = await c.req.text()
  const expectedSig = createHmac("sha256", secret).update(body).digest("hex")
  if (sig !== expectedSig) return c.json({ error: "Invalid signature" }, 400)

  let event: { event: string; payload: { subscription: { entity: Record<string, unknown> } } }
  try {
    event = JSON.parse(body)
  } catch {
    return c.json({ error: "Invalid JSON" }, 400)
  }

  // Deduplicate by event ID (Razorpay includes one; fallback to event string)
  const eventId = (event as unknown as { event_id?: string }).event_id ?? event.event
  if (isWebhookDuplicate(eventId)) return c.json({ ok: true, deduplicated: true })

  try {
    switch (event.event) {
      case "subscription.activated":
      case "subscription.charged":
        await handleSubscriptionActive(event.payload.subscription.entity)
        break
      case "subscription.authenticated":
        await handleSubscriptionActive(event.payload.subscription.entity)
        break
      case "subscription.completed":
      case "subscription.cancelled":
        await handleSubscriptionEnd(event.payload.subscription.entity)
        break
      case "subscription.halted":
        await handlePaymentFailed(event.payload.subscription.entity)
        break
      case "payment.failed":
        await handlePaymentFailed(event.payload.subscription.entity)
        break
      case "subscription.pending":
        // Payment is processing — no action, user checks back later
        break
      case "subscription.paused":
      case "subscription.resumed":
        // Pass through — status managed by Razorpay cycle
        break
    }
  } catch (err) {
    console.error("[yomi/billing] webhook handler error:", err)
    return c.json({ error: "Handler error" }, 500)
  }

  return c.json({ ok: true })
})

// Current subscription info for the dashboard
billingRouter.get("/subscription", authenticate, async (c) => {
  const sessionUser = c.get("user")
  const [user] = await db
    .select({
      id: authSchema.user.id,
      name: authSchema.user.name,
      email: authSchema.user.email,
      role: authSchema.user.role,
      plan: authSchema.user.plan,
      subscriptionStatus: authSchema.user.subscriptionStatus,
      trialEndDate: authSchema.user.trialEndDate,
      currentPeriodEnd: authSchema.user.currentPeriodEnd,
      razorpaySubId: authSchema.user.razorpaySubId,
      trialInteractionUsed: authSchema.user.trialInteractionUsed,
      trialInteractionLimit: authSchema.user.trialInteractionLimit,
      dailyChatCount: authSchema.user.dailyChatCount,
      dailyVoiceCount: authSchema.user.dailyVoiceCount,
      dailyImageCount: authSchema.user.dailyImageCount,
    })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, sessionUser.id))
    .limit(1)

  if (!user) return c.json({ error: "User not found" }, 404)

  const periodStart = user.currentPeriodEnd
    ? new Date(user.currentPeriodEnd.getTime() - 30 * 24 * 60 * 60 * 1000)
    : new Date(0)

  const usageRows = await db
    .select({ inputTokens: usageEvents.inputTokens, outputTokens: usageEvents.outputTokens })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, user.id), gte(usageEvents.createdAt, periodStart)))

  const tokensUsedThisPeriod = usageRows.reduce(
    (sum, r) => sum + (r.inputTokens ?? 0) + (r.outputTokens ?? 0),
    0,
  )

  const requestPeriodStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))

  const kindCounts = await db
    .select({ kind: usageEvents.kind, count: sql<number>`count(*)` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, user.id),
        gte(usageEvents.createdAt, requestPeriodStart),
        inArray(usageEvents.kind, ["request_chat", "request_voice", "stt", "agent_run", "browser_run", "screenshot", "gateway_message", "reasoning"]),
      ),
    )
    .groupBy(usageEvents.kind)

  const countMap: Record<string, number> = {}
  for (const row of kindCounts) countMap[row.kind] = Number(row.count)

  const chatUsed = (countMap["request_chat"] ?? 0)
  const voiceUsed = (countMap["request_voice"] ?? 0)
  const agentUsed = (countMap["agent_run"] ?? 0)
  const browserUsed = (countMap["browser_run"] ?? 0)
  const screenshotUsed = (countMap["screenshot"] ?? 0)
  const gatewayUsed = (countMap["gateway_message"] ?? 0)

  const reasoningUsed = (countMap["reasoning"] ?? 0)

  const requestsUsed = chatUsed + voiceUsed
  const requestsLimit = requestLimitForUser(user)
  const requestsRemaining = requestsLimit === null ? null : Math.max(requestsLimit - requestsUsed, 0)
  const resetAt = new Date(Date.UTC(requestPeriodStart.getUTCFullYear(), requestPeriodStart.getUTCMonth() + 1, 1))

  const features = {
    chat: { used: chatUsed, limit: requestsLimit },
    voice: { used: voiceUsed, limit: featureLimitForUser(user, "voiceMinutes") },
    screenshots: { used: screenshotUsed, limit: featureLimitForUser(user, "screenshots") },
    reasoning: { used: reasoningUsed, limit: featureLimitForUser(user, "reasoning") },
    desktopAutomation: { used: agentUsed, limit: featureLimitForUser(user, "desktopAutomation") },
    browserAutomation: { used: browserUsed, limit: featureLimitForUser(user, "browserAutomation") },
    gatewayMessages: { used: gatewayUsed, limit: featureLimitForUser(user, "gatewayMessages") },
  }

  return c.json({
    name: user.name,
    email: user.email,
    role: effectiveRoleForUser(user),
    plan: effectivePlanForUser(user),
    status: user.subscriptionStatus,
    trialEndDate: user.trialEndDate,
    currentPeriodEnd: user.currentPeriodEnd,
    razorpaySubId: user.razorpaySubId,
    requestsUsed,
    requestsLimit,
    requestsRemaining,
    resetAt,
    features,
    planLimits: (SHARED_PLANS[effectivePlanForUser(user)] ?? SHARED_PLANS["explore"]).limits,
    dailyChatUsed: user.dailyChatCount,
    dailyVoiceUsed: user.dailyVoiceCount,
    dailyImageUsed: user.dailyImageCount,
    tokensUsedThisPeriod,
  })
})

// ── Webhook Helpers ────────────────────────────────────────────────────────────

async function handleSubscriptionActive(entity: Record<string, unknown>) {
  const notes = entity["notes"] as Record<string, string> | undefined
  const userId = notes?.userId
  const plan = notes?.plan
  if (!userId || !plan) return

  const subId = entity["id"] as string
  const customerId = entity["customer_id"] as string
  const periodEnd = entity["current_end"]
    ? new Date((entity["current_end"] as number) * 1000)
    : null

  await db
    .update(authSchema.user)
    .set({
      plan,
      subscriptionStatus: "active",
      razorpayCustomerId: customerId,
      razorpaySubId: subId,
      currentPeriodEnd: periodEnd,
    })
    .where(eq(authSchema.user.id, userId))
}

async function handleSubscriptionEnd(entity: Record<string, unknown>) {
  const notes = entity["notes"] as Record<string, string> | undefined
  const userId = notes?.userId
  if (!userId) return

  await db
    .update(authSchema.user)
    .set({
      plan: "explore",
      subscriptionStatus: "inactive",
      razorpaySubId: null,
      currentPeriodEnd: null,
    })
    .where(eq(authSchema.user.id, userId))
}

async function handlePaymentFailed(entity: Record<string, unknown>) {
  const notes = entity["notes"] as Record<string, string> | undefined
  const userId = notes?.userId
  if (!userId) return

  await db
    .update(authSchema.user)
    .set({ subscriptionStatus: "past_due" })
    .where(eq(authSchema.user.id, userId))
}
