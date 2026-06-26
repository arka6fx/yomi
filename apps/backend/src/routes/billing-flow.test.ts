import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, setSystemTime } from "bun:test"
import { Hono } from "hono"
import { createHmac } from "node:crypto"

// ── Types ────────────────────────────────────────────────────────────────────

type UsageRow = {
  id: string
  userId: string
  kind: string
  createdAt: Date
  creditsCharged: number
}

type GrantRow = {
  id: string
  userId: string
  source: string
  creditsGranted: number
  creditsRemaining: number
  expiresAt: Date | null
  createdAt: Date
  status: string
}

type PaymentRow = {
  id: string
  userId: string
  provider: string
  kind: string
  productKey: string
  providerOrderId: string | null
  providerSubscriptionId: string | null
  status: string
  amountCents: number
  currency: string
}

// ── Shared flow state ────────────────────────────────────────────────────────

const now1 = new Date("2026-06-16T10:00:00Z")
const activeTrialEnd1 = new Date("2026-07-16T10:00:00Z")
const proPeriodEnd1 = new Date("2026-07-16T10:00:00Z")

const flow = {
  user: {
    id: "user_lily",
    email: "lilygorain48@gmail.com",
    name: "Lily",
    role: "user" as const,
    plan: "explore",
    subscriptionStatus: "inactive",
    dodoSubscriptionId: null as string | null,
    dodoCustomerId: null as string | null,
    trialEndDate: activeTrialEnd1,
    currentPeriodEnd: null as Date | null,
    trialInteractionUsed: 0,
    trialInteractionLimit: 100,
    dailyChatCount: 0,
    dailyVoiceCount: 0,
    dailyImageCount: 0,
    createdAt: now1,
  },

  usageEvents: [] as UsageRow[],
  usageIdCounter: 0,

  creditGrants: [] as GrantRow[],
  grantIdCounter: 0,

  paymentRecords: [] as PaymentRow[],
  paymentIdCounter: 0,

  reset() {
    this.user = {
      id: "user_lily",
      email: "lilygorain48@gmail.com",
      name: "Lily",
      role: "user",
      plan: "explore",
      subscriptionStatus: "inactive",
      dodoSubscriptionId: null,
      dodoCustomerId: null,
      trialEndDate: activeTrialEnd1,
      currentPeriodEnd: null,
      trialInteractionUsed: 0,
      trialInteractionLimit: 100,
      dailyChatCount: 0,
      dailyVoiceCount: 0,
      dailyImageCount: 0,
      createdAt: now1,
    }
    this.usageEvents = []
    this.usageIdCounter = 0
    this.creditGrants = []
    this.grantIdCounter = 0
    this.paymentRecords = []
    this.paymentIdCounter = 0
    // Signup hook grants 100 Explore trial credits — with pure-credit gating these are
    // what lets a trial user do anything at all.
    this.grantIdCounter++
    this.creditGrants.push({
      id: `grant_${this.grantIdCounter}`,
      userId: "user_lily",
      source: "subscription_cycle",
      creditsGranted: 100,
      creditsRemaining: 100,
      expiresAt: activeTrialEnd1,
      createdAt: now1,
      status: "active",
    })
  },
}

function monthStart(date = now1): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

// ── Auth module (loaded for table refs only) ─────────────────────────────────

let AUTH_USER_TABLE: any = null
let USAGE_EVENTS_TABLE: any = null
let PAYMENT_RECORDS_TABLE: any = null

// ── Mock DB ──────────────────────────────────────────────────────────────────

const fakeDb = {
  // Table identity checks use reference equality to real drizzle tables

  select: (_fields?: any) => ({
    from: (table: any) => ({
      where: (_conditions: any) => {
        const isUser = table === AUTH_USER_TABLE
        const isUsage = table === USAGE_EVENTS_TABLE || table === (USAGE_EVENTS_TABLE as any)?._
        const isPayments = table === PAYMENT_RECORDS_TABLE

        let result: any[] = []

        if (isUser) {
          result = [{ ...flow.user }]
        } else if (isUsage) {
          const month = monthStart()
          const count = flow.usageEvents.filter(
            (e) => e.createdAt >= month,
          ).length
          result = [{ count }]
        } else if (isPayments) {
          result = []
        }

        const promise = Promise.resolve(result)
        return {
          limit: () => promise,
          groupBy: () => promise,
          then: promise.then.bind(promise),
          catch: promise.catch.bind(promise),
        }
      },
    }),
  }),

  insert: (table: any) => ({
    values: (data: any) => ({
      onConflictDoNothing: () => ({
        returning: (_fields?: any) => Promise.resolve([]),
      }),
      returning: (_fields?: any) => {
        if (table === USAGE_EVENTS_TABLE) {
          flow.usageIdCounter++
          const row: UsageRow = {
            id: `usage_${flow.usageIdCounter}`,
            userId: data.userId ?? flow.user.id,
            kind: data.kind ?? "request_chat",
            createdAt: data.createdAt ?? new Date(),
            creditsCharged: data.creditsCharged ?? 0,
          }
          flow.usageEvents.push(row)
          return Promise.resolve([{ id: row.id }])
        }
        if (table?.source === "subscription_cycle" || table?.source === "credit_pack") {
          flow.grantIdCounter++
          return Promise.resolve([{ id: `grant_${flow.grantIdCounter}` }])
        }
        return Promise.resolve([{ id: "mock_id" }])
      },
    }),
  }),

  update: (table: any) => ({
    set: (data: any) => ({
      where: (_conditions: any) => {
        if (table === AUTH_USER_TABLE) {
          Object.assign(flow.user, data)
        }
        return Promise.resolve({})
      },
    }),
  }),

  delete: (table: any) => ({
    where: (_conditions: any) => {
      if (table === USAGE_EVENTS_TABLE) {
        flow.usageEvents = []
      }
      return Promise.resolve({})
    },
  }),
}

// ── Mocks ────────────────────────────────────────────────────────────────────

mock.module("@yomi/db", () => ({
  db: fakeDb,
  // Table refs that the mock DB uses for identity checks
  usageEvents: { _table: "usage_events" },
  paymentRecords: { _table: "payment_records" },
}))

mock.module("../auth.js", () => ({
  authenticate: async (c: any, next: () => Promise<void>) => {
    c.set("user", flow.user)
    await next()
  },
}))

mock.module("../services/credit-ledger.js", () => ({
  getCreditSummary: async () => {
    const activeGrants = flow.creditGrants.filter(
      (g) => g.status === "active" && g.creditsRemaining > 0,
    )
    const balance = activeGrants.reduce((s, g) => s + g.creditsRemaining, 0)
    return {
      balance,
      lifetimeGranted: flow.creditGrants.reduce((s, g) => s + g.creditsGranted, 0),
      lifetimeConsumed: flow.creditGrants.reduce(
        (s, g) => s + (g.creditsGranted - g.creditsRemaining),
        0,
      ),
      lifetimeRefunded: 0,
      expiringSoon: 0,
      expiringSoonAt: null,
    }
  },

  consumeCredits: async (input: {
    userId: string
    amount: number
    idempotencyKey: string
    usageEventId?: string | null
  }) => {
    const active = flow.creditGrants
      .filter(
        (g) =>
          g.status === "active" &&
          g.creditsRemaining > 0 &&
          (g.expiresAt === null || g.expiresAt > new Date()),
      )
      .sort((a, b) => {
        const aExp = a.expiresAt?.getTime() ?? Infinity
        const bExp = b.expiresAt?.getTime() ?? Infinity
        if (aExp !== bExp) return aExp - bExp
        return a.createdAt.getTime() - b.createdAt.getTime()
      })

    let remaining = input.amount
    let charged = 0
    for (const grant of active) {
      if (remaining <= 0) break
      const debit = Math.min(remaining, grant.creditsRemaining)
      grant.creditsRemaining -= debit
      remaining -= debit
      charged += debit
      if (grant.creditsRemaining === 0) grant.status = "depleted"
    }

    if (remaining > 0) {
      const balance = flow.creditGrants
        .filter((g) => g.status === "active")
        .reduce((s, g) => s + g.creditsRemaining, 0)
      return { ok: false, charged: 0, balance, insufficient: true }
    }

    if (input.usageEventId) {
      const event = flow.usageEvents.find((e) => e.id === input.usageEventId)
      if (event) event.creditsCharged = charged
    }

    const balance = flow.creditGrants
      .filter((g) => g.status === "active")
      .reduce((s, g) => s + g.creditsRemaining, 0)
    return { ok: true, charged, balance }
  },

  grantCredits: async (input: any) => {
    const amount = input.amount ?? 0
    if (amount <= 0) return { granted: false, balance: 0 }
    flow.grantIdCounter++
    const grant: GrantRow = {
      id: `grant_${flow.grantIdCounter}`,
      userId: input.userId ?? flow.user.id,
      source: input.source ?? "subscription_cycle",
      creditsGranted: amount,
      creditsRemaining: amount,
      expiresAt: input.expiresAt ?? null,
      createdAt: new Date(),
      status: "active",
    }
    flow.creditGrants.push(grant)
    const balance = flow.creditGrants
      .filter((g) => g.status === "active")
      .reduce((s, g) => s + g.creditsRemaining, 0)
    return { granted: true, balance }
  },

  expireCredits: async () => 0,

  expireUserCredits: async (userId: string, options?: { sources?: string[] }) => {
    let totalExpired = 0
    for (const grant of flow.creditGrants) {
      if (grant.status !== "active" || grant.creditsRemaining <= 0) continue
      if (options?.sources && !options.sources.includes(grant.source)) continue
      totalExpired += grant.creditsRemaining
      grant.creditsRemaining = 0
      grant.status = "expired"
    }
    return totalExpired
  },

  createPaymentRecord: async (input: any) => {
    return (flow.paymentIdCounter++).toString()
  },

  recentCreditTransactions: async () => [],
}))

mock.module("../services/payment-events.js", () => ({
  payloadHash: () => "hash_1",
  recordPaymentEvent: async () => ({ duplicate: false }),
  upsertPaymentRecord: async (_input: any) => {
    flow.paymentIdCounter++
    return `pay_rec_${flow.paymentIdCounter}`
  },
}))

mock.module("../services/integration-tokens.js", () => ({
  listConnectedProviders: async () => [],
}))

// ── Route setup ──────────────────────────────────────────────────────────────

let billingRouter: import("hono").Hono
let usageRouter: import("hono").Hono

function app() {
  const hono = new Hono()
  hono.route("/api/billing", billingRouter)
  hono.route("/api/usage", usageRouter)
  return hono
}

beforeAll(async () => {
  setSystemTime(now1)

  // Load table refs for identity checks in mock DB
  const authSchema = await import("../auth-schema.js")
  AUTH_USER_TABLE = authSchema.user

  const dbMod = await import("@yomi/db")
  USAGE_EVENTS_TABLE = (dbMod as any).usageEvents

  const billing = await import("./billing.js")
  billingRouter = billing.billingRouter
  usageRouter = (await import("./usage.js")).usageRouter
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function setDodoEnv() {
  const keys: Record<string, string> = {
    DODO_ENV: "test",
    DODO_TEST_API_KEY: "test_key",
    DODO_TEST_WEBHOOK_SECRET: "test_secret",
    DODO_TEST_API_BASE: "https://test-api.dodopayments.com",
    DODO_TEST_PRODUCT_PRO: "test_pro",
    DODO_TEST_PRODUCT_MAX: "test_max",
    DODO_TEST_PRODUCT_CREDITS_500: "test_500",
    DODO_TEST_PRODUCT_CREDITS_2000: "test_2000",
    DODO_TEST_PRODUCT_CREDITS_6000: "test_6000",
  }
  for (const [k, v] of Object.entries(keys)) process.env[k] = v
}

function clearDodoEnv() {
  const keys = [
    "DODO_ENV", "DODO_TEST_API_KEY", "DODO_TEST_WEBHOOK_SECRET", "DODO_TEST_API_BASE",
    "DODO_TEST_PRODUCT_PRO", "DODO_TEST_PRODUCT_MAX",
    "DODO_TEST_PRODUCT_CREDITS_500", "DODO_TEST_PRODUCT_CREDITS_2000",
    "DODO_TEST_PRODUCT_CREDITS_6000",
  ]
  for (const k of keys) delete process.env[k]
}

function validWebhookHeaders(body: string): Record<string, string> {
  const id = "wh_test_1"
  const ts = Math.floor(Date.now() / 1000).toString()
  const signedPayload = `${id}.${ts}.${body}`
  const key = Buffer.from("test_secret")
  const sig = createHmac("sha256", key).update(signedPayload).digest("base64")
  return {
    "webhook-id": id,
    "webhook-timestamp": ts,
    "webhook-signature": `v1,${sig}`,
    "Content-Type": "application/json",
  }
}

function sendWebhook(body: Record<string, unknown>) {
  return app().request("/api/billing/webhook", {
    method: "POST",
    headers: validWebhookHeaders(JSON.stringify(body)),
    body: JSON.stringify(body),
  })
}

function createSubscription(plan: string) {
  return app().request("/api/billing/create-subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  })
}

function createCreditPack(pack: string) {
  return app().request("/api/billing/create-credit-pack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pack }),
  })
}

function reserveChat() {
  return app().request("/api/usage/interactions/reserve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "chat" }),
  })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("E2E: explore -> pro -> consume -> buy credits -> consume -> edge cases", () => {
  let originalFetch: typeof fetch
  let fetchCalls: Array<{ url: string; init?: RequestInit }> = []
  let flowInitialized = false

  beforeEach(() => {
    // Reset flow state only before the FIRST test
    if (!flowInitialized) {
      flow.reset()
      flowInitialized = true
    }
    originalFetch = globalThis.fetch
    fetchCalls = []
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return new Response(
        JSON.stringify({ id: "checkout_1", checkout_url: "https://checkout.example/pro" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as typeof fetch
    setDodoEnv()
  })

  afterEach(() => {
    clearDodoEnv()
    globalThis.fetch = originalFetch
  })

  it("1: starts as Explore user with active trial", async () => {
    expect(flow.user.plan).toBe("explore")
    expect(flow.user.subscriptionStatus).toBe("inactive")
    expect(flow.user.trialEndDate).toEqual(activeTrialEnd1)
    expect(flow.creditGrants.length).toBe(1) // 100 trial credits from signup

    // Can reserve chat (trial active, credits available)
    const res = await reserveChat()
    const body = await res.json() as any
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.plan).toBe("explore")
    expect(body.paidBy).toBe("credits")
    expect(flow.usageEvents.length).toBe(1)
  })

  it("2: creates Pro subscription checkout", async () => {
    const res = await createSubscription("pro")
    const body = await res.json() as any
    expect(res.status).toBe(200)
    expect(body.short_url).toBe("https://checkout.example/pro")
    expect(fetchCalls).toHaveLength(1)
    const payload = JSON.parse(String(fetchCalls[0]?.init?.body ?? "{}"))
    expect(payload.product_cart?.[0]?.product_id).toBe("test_pro")
    expect(payload.metadata).toEqual({
      userId: "user_lily", kind: "subscription", plan: "pro",
    })
  })

  it("3: subscription.active webhook upgrades user to Pro and grants 2500 credits", async () => {
    expect(flow.user.plan).toBe("explore")

    const webhookBody = {
      type: "subscription.active",
      data: {
        subscription_id: "dodo_sub_pro_1",
        customer_id: "dodo_cus_1",
        current_period_end: proPeriodEnd1.toISOString(),
        metadata: { userId: "user_lily", kind: "subscription", plan: "pro" },
      },
    }

    const res = await sendWebhook(webhookBody)
    expect(res.status).toBe(200)

    // User is now Pro with active subscription
    expect(flow.user.plan).toBe("pro")
    expect(flow.user.subscriptionStatus).toBe("active")
    expect(flow.user.dodoSubscriptionId).toBe("dodo_sub_pro_1")
    expect(flow.user.currentPeriodEnd).toEqual(proPeriodEnd1)

    // 2500 credits granted from Pro subscription
    const balance = flow.creditGrants
      .filter((g) => g.status === "active")
      .reduce((s, g) => s + g.creditsRemaining, 0)
    expect(balance).toBe(2500)
    // Trial grant (now expired) + new Pro grant.
    expect(flow.creditGrants.length).toBe(2)
    const proGrant = flow.creditGrants.find((g) => g.status === "active")
    expect(proGrant).toBeDefined()
    expect(proGrant!.source).toBe("subscription_cycle")
    expect(proGrant!.creditsGranted).toBe(2500)
  })

  it("4: consumes all 2500 Pro credits, then blocks with credits_exhausted", async () => {
    // Pure-credit gating: 2500 credits = 2500 chats (1 credit each), then blocked.
    const TOTAL_CREDITS = 2500
    let lastBody: any = null

    for (let i = 0; i < TOTAL_CREDITS; i++) {
      const res = await reserveChat()
      expect(res.status).toBe(200)
      lastBody = await res.json() as any
      expect(lastBody.ok).toBe(true)
    }

    // After 2500 chats, all credits consumed.
    expect(lastBody.creditsRemaining).toBe(0)

    // No credits remain -> next request is blocked (buy a pack on Pro).
    const failRes = await reserveChat()
    const failBody = await failRes.json() as any
    expect(failRes.status).toBe(402)
    expect(failBody.code).toBe("credits_exhausted")
  }, 60_000)

  it("5: buys a 500-credit pack after exhausting Pro credits", async () => {
    expect(flow.user.plan).toBe("pro")

    const checkoutRes = await createCreditPack("credits_500")
    const checkoutBody = await checkoutRes.json() as any
    expect(checkoutRes.status).toBe(200)
    expect(checkoutBody.short_url).toBe("https://checkout.example/pro")

    const payload = JSON.parse(String(fetchCalls[fetchCalls.length - 1]?.init?.body ?? "{}"))
    expect(payload.metadata).toEqual({
      userId: "user_lily", kind: "credit_pack", productKey: "credits_500",
    })

    // payment.succeeded webhook
    const webhookBody = {
      type: "payment.succeeded",
      data: {
        payment_id: "pay_credit_500",
        checkout_id: "checkout_500",
        amount: 499,
        currency: "USD",
        metadata: {
          userId: "user_lily",
          kind: "credit_pack",
          productKey: "credits_500",
        },
      },
    }
    const whRes = await sendWebhook(webhookBody)
    expect(whRes.status).toBe(200)

    // Should have 500 credits now
    const balance = flow.creditGrants
      .filter((g) => g.status === "active")
      .reduce((s, g) => s + g.creditsRemaining, 0)
    expect(balance).toBe(500)

    const packGrant = flow.creditGrants.find((g) => g.source === "credit_pack")
    expect(packGrant).toBeDefined()
    expect(packGrant!.creditsGranted).toBe(500)
  })

  it("6: consumes the 500 purchased credits", async () => {
    const balance = flow.creditGrants
      .filter((g) => g.status === "active")
      .reduce((s, g) => s + g.creditsRemaining, 0)
    expect(balance).toBe(500)

    for (let i = 0; i < 500; i++) {
      const res = await reserveChat()
      expect(res.status).toBe(200)
      const body = await res.json() as any
      expect(body.ok).toBe(true)
      expect(body.paidBy).toBe("credits")
    }

    // No credits left
    const remaining = flow.creditGrants
      .filter((g) => g.status === "active")
      .reduce((s, g) => s + g.creditsRemaining, 0)
    expect(remaining).toBe(0)

    // Next request fails
    const failRes = await reserveChat()
    const failBody = await failRes.json() as any
    expect(failRes.status).toBe(402)
    expect(failBody.code).toBe("credits_exhausted")
  })

  it("7: Explore trial credits are not usable after Pro upgrade", async () => {
    // Reset and start fresh — drop the auto-seeded trial grant so this test controls
    // the grant ids it asserts on below.
    flow.reset()
    flow.creditGrants = []
    flow.grantIdCounter = 0

    // Grant 100 trial credits (simulating auth.ts signup hook)
    flow.grantIdCounter++
    flow.creditGrants.push({
      id: `grant_trial_1`,
      userId: "user_lily",
      source: "subscription_cycle",
      creditsGranted: 100,
      creditsRemaining: 100,
      expiresAt: activeTrialEnd1,
      createdAt: new Date(now1.getTime() - 24 * 60 * 60 * 1000),
      status: "active",
    })

    expect(
      flow.creditGrants.filter((g) => g.status === "active")
        .reduce((s, g) => s + g.creditsRemaining, 0),
    ).toBe(100)

    // Simulate Pro upgrade webhook
    const webhookBody = {
      type: "subscription.active",
      data: {
        subscription_id: "dodo_sub_pro_2",
        customer_id: "dodo_cus_2",
        current_period_end: proPeriodEnd1.toISOString(),
        metadata: { userId: "user_lily", kind: "subscription", plan: "pro" },
      },
    }

    const res = await sendWebhook(webhookBody)
    expect(res.status).toBe(200)
    expect(flow.user.plan).toBe("pro")

    // After upgrade, trial credits should be expired
    const trialGrant = flow.creditGrants.find((g) => g.id === "grant_trial_1")
    expect(trialGrant).toBeDefined()

    // expireUserCredits runs before grantCredits, so trial credits are gone
    // Only the new Pro subscription credits should remain
    const activeBalance = flow.creditGrants
      .filter((g) => g.status === "active")
      .reduce((s, g) => s + g.creditsRemaining, 0)
    expect(activeBalance).toBe(2500)
    expect(trialGrant!.status).toBe("expired")
    expect(trialGrant!.creditsRemaining).toBe(0)
  })
})


