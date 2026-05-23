import { Hono } from "hono"
import Razorpay from "razorpay"
import { createHmac } from "node:crypto"
import { db, subscriptions, usageEvents } from "@yomi/db"
import { eq, and, gte } from "drizzle-orm"
import { authenticate } from "../auth.js"

// Lazy init — Razorpay throws at construction if key is missing
let _razorpay: Razorpay | null = null
function getRazorpay(): Razorpay {
  if (!_razorpay) {
    const key_id = process.env["RAZORPAY_KEY_ID"]
    const key_secret = process.env["RAZORPAY_KEY_SECRET"]
    if (!key_id || !key_secret) throw new Error("Razorpay credentials not configured")
    _razorpay = new Razorpay({ key_id, key_secret })
  }
  return _razorpay
}

const PLAN_AMOUNTS: Record<string, number> = {
  basic: 400,
  standard: 900,
  genesis: 1900,
}

const PLAN_PERIODS: Record<string, { period: string; interval: number; totalCount: number }> = {
  basic: { period: "monthly", interval: 1, totalCount: 12 },
  standard: { period: "monthly", interval: 1, totalCount: 12 },
  genesis: { period: "monthly", interval: 1, totalCount: 12 },
}

export const billingRouter = new Hono()

// Create Razorpay subscription
billingRouter.post("/create-subscription", authenticate, async (c) => {
  const { plan, returnUrl } = await c.req.json() as { plan: string; returnUrl: string }
  const user = c.get("user")

  const amount = PLAN_AMOUNTS[plan]
  if (!amount) return c.json({ error: "Unknown plan" }, 400)

  const period = PLAN_PERIODS[plan]!

  // Look up existing subscription
  const [existing] = await db
    .select({ razorpayCustomerId: subscriptions.razorpayCustomerId, razorpaySubId: subscriptions.razorpaySubId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .limit(1)

  // Create or reuse Razorpay customer
  let customerId = existing?.razorpayCustomerId
  if (!customerId) {
    const customer = await getRazorpay().customers.create({
      name: user.name,
      email: user.email,
      contact: "",
    })
    customerId = customer.id
  }

  // Create a plan (Razorpay requires plan creation per subscription)
  const planObj = await getRazorpay().plans.create({
    period: period.period as "monthly",
    interval: period.interval,
    item: {
      name: `Yomi ${plan.charAt(0).toUpperCase() + plan.slice(1)}`,
      amount,
      currency: "USD",
    },
  })

  const subscription = await getRazorpay().subscriptions.create({
    plan_id: (planObj as { id: string }).id,
    customer_notify: 1,
    total_count: period.totalCount,
    notes: {
      userId: user.id,
      plan,
    },
  })

  return c.json({
    id: subscription.id,
    short_url: subscription.short_url,
  })
})

// Razorpay webhook
billingRouter.post("/webhook", async (c) => {
  const secret = process.env["RAZORPAY_WEBHOOK_SECRET"]
  const sig = c.req.header("x-razorpay-signature")
  if (!sig || !secret) return c.json({ error: "No signature" }, 400)

  const body = await c.req.text()
  const expectedSig = createHmac("sha256", secret).update(body).digest("hex")
  if (sig !== expectedSig) return c.json({ error: "Invalid signature" }, 400)

  const event = JSON.parse(body) as { event: string; payload: { subscription: { entity: Record<string, unknown> } } }

  switch (event.event) {
    case "subscription.activated":
    case "subscription.charged":
      await handleSubscriptionEvent(event.payload.subscription.entity)
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

// Current subscription + usage this billing period
billingRouter.get("/subscription", authenticate, async (c) => {
  const user = c.get("user")

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .limit(1)

  const periodStart = sub?.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd.getTime() - 30 * 24 * 60 * 60 * 1000)
    : new Date(0)

  const usageRows = await db
    .select({ inputTokens: usageEvents.inputTokens, outputTokens: usageEvents.outputTokens })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, user.id),
        gte(usageEvents.createdAt, periodStart),
      ),
    )

  const totalTokens = usageRows.reduce(
    (sum, r) => sum + (r.inputTokens ?? 0) + (r.outputTokens ?? 0),
    0,
  )

  return c.json({
    plan: sub?.plan ?? "free",
    status: sub?.status ?? "active",
    currentPeriodEnd: sub?.currentPeriodEnd,
    tokensUsedThisPeriod: totalTokens,
  })
})

// --- Webhook helpers ---

async function handleSubscriptionEvent(entity: Record<string, unknown>) {
  const notes = entity["notes"] as Record<string, string> | undefined
  const userId = notes?.userId
  const plan = notes?.plan
  if (!userId || !plan) return

  const subId = entity["id"] as string
  const customerId = entity["customer_id"] as string
  const periodEnd = entity["current_end"] ? new Date((entity["current_end"] as number) * 1000) : null

  const [existing] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1)

  if (existing) {
    await db
      .update(subscriptions)
      .set({ razorpayCustomerId: customerId, razorpaySubId: subId, plan, status: "active", currentPeriodEnd: periodEnd, updatedAt: new Date() })
      .where(eq(subscriptions.userId, userId))
  } else {
    await db.insert(subscriptions).values({
      userId,
      razorpayCustomerId: customerId,
      razorpaySubId: subId,
      plan,
      status: "active",
      currentPeriodEnd: periodEnd,
    })
  }
}

async function handleSubscriptionEnd(entity: Record<string, unknown>) {
  const customerId = entity["customer_id"] as string
  await db
    .update(subscriptions)
    .set({ plan: "free", status: "active", razorpaySubId: null, updatedAt: new Date() })
    .where(eq(subscriptions.razorpayCustomerId, customerId))
}

async function handlePaymentFailed(entity: Record<string, unknown>) {
  const customerId = entity["customer_id"] as string
  await db
    .update(subscriptions)
    .set({ status: "past_due", updatedAt: new Date() })
    .where(eq(subscriptions.razorpayCustomerId, customerId))
}
