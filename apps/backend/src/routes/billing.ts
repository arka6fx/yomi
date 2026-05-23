import { Hono } from "hono"
import { createHmac } from "node:crypto"
import { db, usageEvents } from "@yomi/db"
import { eq, and, gte } from "drizzle-orm"
import { authenticate } from "../auth.js"
import * as authSchema from "../auth-schema.js"

// Plans: explore (free trial), pro ($8.99), max ($18.99)
const PLAN_AMOUNTS: Record<string, number> = {
  pro: 899,
  max: 1899,
}

const PLAN_PERIODS: Record<string, { period: string; interval: number; totalCount: number }> = {
  pro: { period: "monthly", interval: 1, totalCount: 12 },
  max: { period: "monthly", interval: 1, totalCount: 12 },
}

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
  if (!res.ok) throw new Error(`Razorpay ${path} → ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export const billingRouter = new Hono()

// Create Razorpay subscription
billingRouter.post("/create-subscription", authenticate, async (c) => {
  const { plan } = await c.req.json() as { plan: string }
  const user = c.get("user")

  const amount = PLAN_AMOUNTS[plan]
  if (!amount) return c.json({ error: "Unknown plan" }, 400)

  const period = PLAN_PERIODS[plan]!

  // Reuse existing customer ID if present, otherwise create one
  let customerId = user.razorpayCustomerId ?? ""
  if (!customerId) {
    const customer = await rzp<{ id: string }>("/customers", {
      name: user.name,
      email: user.email,
      contact: "",
    })
    customerId = customer.id
    await db.update(authSchema.user)
      .set({ razorpayCustomerId: customerId })
      .where(eq(authSchema.user.id, user.id))
  }

  const planObj = await rzp<{ id: string }>("/plans", {
    period: period.period,
    interval: period.interval,
    item: {
      name: `Yomi ${plan.charAt(0).toUpperCase() + plan.slice(1)}`,
      amount,
      currency: "USD",
    },
  })

  const subscription = await rzp<{ id: string; short_url: string }>("/subscriptions", {
    plan_id: planObj.id,
    customer_notify: 1,
    total_count: period.totalCount,
    notes: { userId: user.id, plan },
  })

  return c.json({ id: subscription.id, short_url: subscription.short_url })
})

// Razorpay webhook — update user plan on subscription events
billingRouter.post("/webhook", async (c) => {
  const secret = process.env["RAZORPAY_WEBHOOK_SECRET"]
  const sig = c.req.header("x-razorpay-signature")
  if (!sig || !secret) return c.json({ error: "No signature" }, 400)

  const body = await c.req.text()
  const expectedSig = createHmac("sha256", secret).update(body).digest("hex")
  if (sig !== expectedSig) return c.json({ error: "Invalid signature" }, 400)

  const event = JSON.parse(body) as {
    event: string
    payload: { subscription: { entity: Record<string, unknown> } }
  }

  switch (event.event) {
    case "subscription.activated":
    case "subscription.charged":
      await handleSubscriptionActive(event.payload.subscription.entity)
      break
    case "subscription.completed":
    case "subscription.cancelled":
      await handleSubscriptionEnd(event.payload.subscription.entity)
      break
    case "payment.failed":
      await handlePaymentFailed(event.payload.subscription.entity)
      break
  }

  return c.json({ ok: true })
})

// Current subscription info for the dashboard
billingRouter.get("/subscription", authenticate, async (c) => {
  const user = c.get("user")

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

  return c.json({
    role:               user.role,
    plan:               user.plan,
    status:             user.subscriptionStatus,
    trialEndDate:       user.trialEndDate,
    currentPeriodEnd:   user.currentPeriodEnd,
    dailyChatUsed:      user.dailyChatCount,
    dailyVoiceUsed:     user.dailyVoiceCount,
    dailyImageUsed:     user.dailyImageCount,
    tokensUsedThisPeriod,
  })
})

// --- Webhook helpers ---

async function handleSubscriptionActive(entity: Record<string, unknown>) {
  const notes = entity["notes"] as Record<string, string> | undefined
  const userId = notes?.userId
  const plan = notes?.plan
  if (!userId || !plan) return

  const subId = entity["id"] as string
  const customerId = entity["customer_id"] as string
  const periodEnd = entity["current_end"] ? new Date((entity["current_end"] as number) * 1000) : null

  await db.update(authSchema.user).set({
    plan,
    subscriptionStatus:  "active",
    razorpayCustomerId:  customerId,
    razorpaySubId:       subId,
    currentPeriodEnd:    periodEnd,
  }).where(eq(authSchema.user.id, userId))
}

async function handleSubscriptionEnd(entity: Record<string, unknown>) {
  const notes = entity["notes"] as Record<string, string> | undefined
  const userId = notes?.userId
  if (!userId) return

  await db.update(authSchema.user).set({
    plan:               "explore",
    subscriptionStatus: "inactive",
    razorpaySubId:      null,
    currentPeriodEnd:   null,
  }).where(eq(authSchema.user.id, userId))
}

async function handlePaymentFailed(entity: Record<string, unknown>) {
  const notes = entity["notes"] as Record<string, string> | undefined
  const userId = notes?.userId
  if (!userId) return

  await db.update(authSchema.user).set({ subscriptionStatus: "past_due" })
    .where(eq(authSchema.user.id, userId))
}
