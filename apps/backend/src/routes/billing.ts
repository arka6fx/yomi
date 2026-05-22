import { Hono } from "hono"
import Stripe from "stripe"
import { db, subscriptions, usageEvents } from "@yomi/db"
import { eq, and, gte } from "drizzle-orm"
import { authenticate } from "../auth.js"

const stripe = new Stripe(process.env["STRIPE_SECRET_KEY"]!, {
  apiVersion: "2024-06-20",
})

const PRICE_IDS: Record<string, string> = {
  pro: process.env["STRIPE_PRO_PRICE_ID"] ?? "",
  max: process.env["STRIPE_MAX_PRICE_ID"] ?? "",
  team: process.env["STRIPE_TEAM_PRICE_ID"] ?? "",
}

export const billingRouter = new Hono()

// Create Stripe Checkout session for a plan upgrade
billingRouter.post("/create-checkout", authenticate, async (c) => {
  const { plan, returnUrl } = await c.req.json() as { plan: string; returnUrl: string }
  const user = c.get("user")

  const priceId = PRICE_IDS[plan]
  if (!priceId) return c.json({ error: "Unknown plan" }, 400)

  // Look up or create Stripe customer
  let customerId: string | undefined
  const [sub] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .limit(1)
  customerId = sub?.stripeCustomerId

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    customer_email: customerId ? undefined : user.email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: returnUrl,
    metadata: { userId: user.id, plan },
  })

  return c.json({ url: session.url })
})

// Create Stripe Customer Portal link for self-service management
billingRouter.post("/portal", authenticate, async (c) => {
  const { returnUrl } = await c.req.json() as { returnUrl: string }
  const user = c.get("user")

  const [sub] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .limit(1)

  if (!sub?.stripeCustomerId) {
    return c.json({ error: "No billing account" }, 404)
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: returnUrl,
  })

  return c.json({ url: session.url })
})

// Stripe webhook — signature-verified, unauthenticated
billingRouter.post("/webhook", async (c) => {
  const sig = c.req.header("stripe-signature")
  if (!sig) return c.json({ error: "No signature" }, 400)

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      await c.req.text(),
      sig,
      process.env["STRIPE_WEBHOOK_SECRET"]!,
    )
  } catch {
    return c.json({ error: "Invalid signature" }, 400)
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutComplete(event.data.object as Stripe.Checkout.Session)
      break
    case "customer.subscription.updated":
      await syncSubscription(event.data.object as Stripe.Subscription)
      break
    case "customer.subscription.deleted":
      await downgradeToFree((event.data.object as Stripe.Subscription).customer as string)
      break
    case "invoice.payment_failed":
      await markPaymentFailed((event.data.object as Stripe.Invoice).customer as string)
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

async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId
  const plan = session.metadata?.plan
  if (!userId || !plan || !session.subscription || !session.customer) return

  const stripeSubId = typeof session.subscription === "string"
    ? session.subscription
    : session.subscription.id
  const stripeCustomerId = typeof session.customer === "string"
    ? session.customer
    : session.customer.id

  const stripeSub = await stripe.subscriptions.retrieve(stripeSubId)
  const periodEnd = new Date(stripeSub.current_period_end * 1000)

  const [existing] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1)

  if (existing) {
    await db
      .update(subscriptions)
      .set({ stripeCustomerId, stripeSubId, plan, status: "active", currentPeriodEnd: periodEnd, updatedAt: new Date() })
      .where(eq(subscriptions.userId, userId))
  } else {
    await db.insert(subscriptions).values({
      userId,
      stripeCustomerId,
      stripeSubId,
      plan,
      status: "active",
      currentPeriodEnd: periodEnd,
    })
  }
}

async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id
  const plan = (sub.metadata?.["plan"] as string | undefined) ?? "pro"

  await db
    .update(subscriptions)
    .set({
      plan,
      status: sub.status === "active" ? "active" : sub.status,
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.stripeCustomerId, customerId))
}

async function downgradeToFree(customerId: string) {
  await db
    .update(subscriptions)
    .set({ plan: "free", status: "active", stripeSubId: null, updatedAt: new Date() })
    .where(eq(subscriptions.stripeCustomerId, customerId))
}

async function markPaymentFailed(customerId: string) {
  await db
    .update(subscriptions)
    .set({ status: "past_due", updatedAt: new Date() })
    .where(eq(subscriptions.stripeCustomerId, customerId))
}
