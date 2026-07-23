import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"
import { createHmac } from "node:crypto"

type TestUser = {
  id: string
  name?: string | null
  email?: string | null
  role?: string | null
  plan: string
  subscriptionStatus: string
  dodoSubscriptionId: string | null
  trialEndDate?: Date | null
  currentPeriodEnd?: Date | null
}

type FetchCall = {
  url: string
  init?: RequestInit
}

let currentUser: TestUser
let originalFetch: typeof fetch
let fetchCalls: FetchCall[] = []

// Fail fast on any fetch a test forgot to mock. The Dodo env vars set below use
// the real test-API hostname, so an unmocked path would otherwise make live
// network calls and flake the suite on connectivity.
globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  throw new Error(`unmocked fetch in billing.test.ts: ${url}`)
}) as typeof fetch

let mockState: {
  dbSelectResult: any[]
  dbSelectQueue: any[][]
  dbUpdateResult: any
  dbInsertReturning: any[]
  connectedProviders: string[]
  creditSummary: any
  recentCreditTransactions: any[]
  recordPaymentEvent: (input: any) => Promise<{ duplicate: boolean }>
  upsertPaymentRecord: (input: any) => Promise<string | null>
  grantCredits: (input: any) => Promise<any>
  createPaymentRecord: (input: any) => Promise<string | null>
}

function resetMockState() {
  mockState = {
    dbSelectResult: [],
    dbSelectQueue: [],
    dbUpdateResult: {},
    dbInsertReturning: [],
    connectedProviders: [],
    creditSummary: {
      balance: 0,
      lifetimeGranted: 0,
      lifetimeConsumed: 0,
      lifetimeRefunded: 0,
      expiringSoon: 0,
      expiringSoonAt: null,
    },
    recentCreditTransactions: [],
    recordPaymentEvent: async () => ({ duplicate: false }),
    upsertPaymentRecord: async () => "payment_1",
    grantCredits: async () => ({ granted: true, balance: 100 }),
    createPaymentRecord: async () => "payment_1",
  }
}

function nextSelectRows() {
  return mockState.dbSelectQueue.length > 0
    ? mockState.dbSelectQueue.shift()!
    : mockState.dbSelectResult
}

const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => {
        const promise = Promise.resolve(nextSelectRows())
        return {
          limit: () => promise,
          groupBy: () => promise,
          then: promise.then.bind(promise),
          catch: promise.catch.bind(promise),
        }
      },
    }),
  }),
  update: () => ({
    set: () => ({
      where: () => Promise.resolve(mockState.dbUpdateResult),
    }),
  }),
  insert: () => ({
    values: () => ({
      onConflictDoNothing: () => ({
        returning: () => Promise.resolve(mockState.dbInsertReturning),
      }),
      returning: () => Promise.resolve(mockState.dbInsertReturning),
    }),
  }),
}

mock.module("@yomi/db", () => ({
  db: fakeDb,
  usageEvents: {},
  paymentRecords: {},
  processedPaymentEvents: {},
  mcpConnections: {},
  // Stubs for exports consumed by rag/usage tests loaded in the same suite
  ragChunks: {},
  ragDocuments: {},
  ragEmbeddings: {},
  ragRetrievalLogs: {},
  ragSources: {},
}))

mock.module("../auth.js", () => ({
  authenticate: async (c: any, next: () => Promise<void>) => {
    c.set("user", currentUser)
    await next()
  },
  getAuth: () => ({
    api: {
      getSession: async () => ({ user: currentUser, session: { id: "session_1" } }),
    },
  }),
}))

mock.module("../services/credit-ledger.js", () => ({
  createPaymentRecord: async (input: any) => mockState.createPaymentRecord(input),
  getCreditSummary: async () => mockState.creditSummary,
  grantCredits: async (input: any) => mockState.grantCredits(input),
  recentCreditTransactions: async () => mockState.recentCreditTransactions,
  // Stub for usage tests loaded in the same suite
  consumeCredits: async () => ({ ok: true }),
  expireUserCredits: async () => 0,
}))

mock.module("../services/integration-tokens.js", () => ({
  listConnectedProviders: async () => mockState.connectedProviders,
}))

mock.module("../services/payment-events.js", () => ({
  payloadHash: () => "hash_1",
  recordPaymentEvent: async (input: any) => mockState.recordPaymentEvent(input),
  upsertPaymentRecord: async (input: any) => mockState.upsertPaymentRecord(input),
}))

let billingRouter: import("hono").Hono
let getDodoConfig: (...args: any[]) => any
let verifyDodoWebhook: (...args: any[]) => any

beforeAll(async () => {
  const mod = await import("./billing.js")
  billingRouter = mod.billingRouter
  getDodoConfig = mod.getDodoConfig
  verifyDodoWebhook = mod.verifyDodoWebhook
})

afterAll(() => {
  mock.restore()
})

function app() {
  const hono = new Hono()
  hono.route("/api/billing", billingRouter)
  return hono
}

function setDodoEnv(mode: "test" | "live") {
  process.env.DODO_ENV = mode
  process.env.DODO_TEST_API_KEY = "test_key"
  process.env.DODO_TEST_WEBHOOK_SECRET = "test_secret"
  process.env.DODO_TEST_API_BASE = "https://test-api.dodopayments.com"
  process.env.DODO_TEST_PRODUCT_PRO = "test_pro"
  process.env.DODO_TEST_PRODUCT_MAX = "test_max"
  process.env.DODO_TEST_PRODUCT_CREDITS_500 = "test_500"
  process.env.DODO_TEST_PRODUCT_CREDITS_2000 = "test_2000"
  process.env.DODO_TEST_PRODUCT_CREDITS_6000 = "test_6000"

  process.env.DODO_LIVE_API_KEY = "live_key"
  process.env.DODO_LIVE_WEBHOOK_SECRET = "live_secret"
  process.env.DODO_LIVE_API_BASE = "https://live-api.dodopayments.com"
  process.env.DODO_LIVE_PRODUCT_PRO = "live_pro"
  process.env.DODO_LIVE_PRODUCT_MAX = "live_max"
  process.env.DODO_LIVE_PRODUCT_CREDITS_500 = "live_500"
  process.env.DODO_LIVE_PRODUCT_CREDITS_2000 = "live_2000"
  process.env.DODO_LIVE_PRODUCT_CREDITS_6000 = "live_6000"
}

function clearDodoEnv() {
  const keys = [
    "DODO_ENV",
    "DODO_TEST_API_KEY",
    "DODO_TEST_WEBHOOK_SECRET",
    "DODO_TEST_API_BASE",
    "DODO_TEST_PRODUCT_PRO",
    "DODO_TEST_PRODUCT_MAX",
    "DODO_TEST_PRODUCT_CREDITS_500",
    "DODO_TEST_PRODUCT_CREDITS_2000",
    "DODO_TEST_PRODUCT_CREDITS_6000",
    "DODO_LIVE_API_KEY",
    "DODO_LIVE_WEBHOOK_SECRET",
    "DODO_LIVE_API_BASE",
    "DODO_LIVE_PRODUCT_PRO",
    "DODO_LIVE_PRODUCT_MAX",
    "DODO_LIVE_PRODUCT_CREDITS_500",
    "DODO_LIVE_PRODUCT_CREDITS_2000",
    "DODO_LIVE_PRODUCT_CREDITS_6000",
    "DODO_API_KEY",
    "DODO_WEBHOOK_SECRET",
    "DODO_API_BASE",
    "DODO_PRODUCT_PRO",
    "DODO_PRODUCT_MAX",
    "DODO_PRODUCT_CREDITS_500",
    "DODO_PRODUCT_CREDITS_2000",
    "DODO_PRODUCT_CREDITS_6000",
  ]
  for (const k of keys) delete process.env[k]
}

function validWebhookHeaders(body: string, secret = "test_secret"): Record<string, string> {
  const id = "wh_test_1"
  const ts = Math.floor(Date.now() / 1000).toString()
  const signedPayload = `${id}.${ts}.${body}`
  const key = Buffer.from(secret)
  const sig = createHmac("sha256", key).update(signedPayload).digest("base64")
  return {
    "webhook-id": id,
    "webhook-timestamp": ts,
    "webhook-signature": `v1,${sig}`,
    "Content-Type": "application/json",
  }
}

function createSubscription(plan: "pro" | "max") {
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

function cancelSubscription() {
  return app().request("/api/billing/cancel-subscription", { method: "POST" })
}

function getSubscription() {
  return app().request("/api/billing/subscription")
}

function getUsageSummary() {
  return app().request("/api/billing/usage-summary")
}

function sendWebhook(body: Record<string, unknown>, headers?: Record<string, string>) {
  const raw = JSON.stringify(body)
  return app().request("/api/billing/webhook", {
    method: "POST",
    headers: headers ?? validWebhookHeaders(raw),
    body: raw,
  })
}

// ── Configuration ─────────────────────────────────────────────────────

describe("Dodo billing — configuration", () => {
  beforeEach(() => {
    currentUser = {
      id: "user_1",
      name: "Arka",
      email: "arka@example.com",
      plan: "explore",
      subscriptionStatus: "inactive",
      dodoSubscriptionId: null,
    }
  })

  afterEach(clearDodoEnv)

  it("resolves test-mode Dodo values from DODO_TEST_* env vars", () => {
    setDodoEnv("test")
    const config = getDodoConfig()
    expect(config.mode).toBe("test")
    expect(config.apiBase).toBe("https://test-api.dodopayments.com")
    expect(config.apiKey).toBe("test_key")
    expect(config.webhookSecret).toBe("test_secret")
    expect(config.productIds.pro).toBe("test_pro")
    expect(config.productIds.credits_6000).toBe("test_6000")
  })

  it("resolves live-mode Dodo values from DODO_LIVE_* env vars", () => {
    setDodoEnv("live")
    const config = getDodoConfig()
    expect(config.mode).toBe("live")
    expect(config.apiBase).toBe("https://live-api.dodopayments.com")
    expect(config.apiKey).toBe("live_key")
    expect(config.webhookSecret).toBe("live_secret")
    expect(config.productIds.max).toBe("live_max")
    expect(config.productIds.credits_500).toBe("live_500")
  })

  it("falls back to DODO_* (legacy) when DODO_MODE env vars are not set", () => {
    clearDodoEnv()
    process.env.DODO_API_KEY = "legacy_key"
    process.env.DODO_WEBHOOK_SECRET = "legacy_secret"
    process.env.DODO_PRODUCT_PRO = "legacy_pro"
    process.env.DODO_ENV = "test"
    const config = getDodoConfig()
    expect(config.apiKey).toBe("legacy_key")
    expect(config.productIds.pro).toBe("legacy_pro")
  })

  it("defaults to test.dodopayments.com when no API_BASE is configured", () => {
    clearDodoEnv()
    process.env.DODO_ENV = "test"
    process.env.DODO_TEST_API_KEY = "key"
    process.env.DODO_TEST_PRODUCT_PRO = "pro"
    process.env.DODO_TEST_PRODUCT_MAX = "max"
    process.env.DODO_TEST_PRODUCT_CREDITS_500 = "c500"
    process.env.DODO_TEST_PRODUCT_CREDITS_2000 = "c2000"
    process.env.DODO_TEST_PRODUCT_CREDITS_6000 = "c6000"
    delete process.env.DODO_TEST_API_BASE
    const config = getDodoConfig()
    expect(config.apiBase).toBe("https://test.dodopayments.com")
  })

  it("defaults to live.dodopayments.com when in live mode and no API_BASE", () => {
    clearDodoEnv()
    process.env.DODO_ENV = "live"
    process.env.DODO_LIVE_API_KEY = "key"
    process.env.DODO_LIVE_PRODUCT_PRO = "pro"
    process.env.DODO_LIVE_PRODUCT_MAX = "max"
    process.env.DODO_LIVE_PRODUCT_CREDITS_500 = "c500"
    process.env.DODO_LIVE_PRODUCT_CREDITS_2000 = "c2000"
    process.env.DODO_LIVE_PRODUCT_CREDITS_6000 = "c6000"
    delete process.env.DODO_LIVE_API_BASE
    const config = getDodoConfig()
    expect(config.apiBase).toBe("https://live.dodopayments.com")
  })

  it("defaults to test when DODO_ENV is invalid", () => {
    clearDodoEnv()
    process.env.DODO_ENV = "production"
    process.env.DODO_TEST_API_KEY = "key"
    process.env.DODO_TEST_API_BASE = "https://test.dodopayments.com"
    process.env.DODO_TEST_PRODUCT_PRO = "pro"
    process.env.DODO_TEST_PRODUCT_MAX = "max"
    process.env.DODO_TEST_PRODUCT_CREDITS_500 = "c500"
    process.env.DODO_TEST_PRODUCT_CREDITS_2000 = "c2000"
    process.env.DODO_TEST_PRODUCT_CREDITS_6000 = "c6000"
    const config = getDodoConfig()
    expect(config.mode).toBe("test")
  })

  it("returns null apiKey when no API_KEY is set", () => {
    clearDodoEnv()
    process.env.DODO_ENV = "test"
    const config = getDodoConfig()
    expect(config.apiKey).toBeNull()
  })
})

// ── Plan Catalog ──────────────────────────────────────────────────────

describe("Dodo billing — plan catalog", () => {
  beforeEach(() => {
    resetMockState()
    currentUser = {
      id: "user_1",
      name: "Arka",
      email: "arka@example.com",
      plan: "explore",
      subscriptionStatus: "inactive",
      dodoSubscriptionId: null,
    }
  })

  it("lists all subscription plans with credit-oriented feature copy", async () => {
    const res = await app().request("/api/billing/plans")
    const body = (await res.json()) as any

    expect(res.status).toBe(200)
    expect(body.plans.map((plan: any) => plan.key)).toEqual(["explore", "pro", "max"])

    const explore = body.plans.find((plan: any) => plan.key === "explore")
    expect(explore.amountCents).toBe(0)
    expect(explore.includedCredits).toBe(100)
    expect(explore.features).toContain("100 trial credits")
    expect(explore.features).toContain("Screen-aware AI and voice")
    expect(explore.features).toContain("Unlimited app connectors")
    expect(explore.features).toContain("30-day free trial")

    const pro = body.plans.find((plan: any) => plan.key === "pro")
    expect(pro.amountCents).toBe(500)
    expect(pro.includedCredits).toBe(300)
    expect(pro.features).toContain("300 credits / month")
    expect(pro.features).toContain("Credit packs available")

    const max = body.plans.find((plan: any) => plan.key === "max")
    expect(max.amountCents).toBe(3999)
    expect(max.includedCredits).toBe(750)
    expect(max.features).toContain("750 credits / month")
  })
})

// ── Webhook Verification ──────────────────────────────────────────────

describe("Dodo billing — webhook verification", () => {
  beforeEach(() => {
    resetMockState()
    currentUser = {
      id: "user_1",
      name: "Arka",
      email: "arka@example.com",
      plan: "explore",
      subscriptionStatus: "inactive",
      dodoSubscriptionId: null,
    }
    setDodoEnv("test")
  })

  afterEach(clearDodoEnv)

  it("accepts a valid signature within the freshness window", () => {
    const body = JSON.stringify({ type: "subscription.active" })
    const headers = new Headers(validWebhookHeaders(body))
    expect(verifyDodoWebhook(body, headers)).toBe(true)
  })

  it("rejects when webhook secret is not configured", () => {
    delete process.env.DODO_TEST_WEBHOOK_SECRET
    const body = JSON.stringify({ type: "subscription.active" })
    const headers = new Headers(validWebhookHeaders(body, ""))
    expect(verifyDodoWebhook(body, headers)).toBe(false)
  })

  it("rejects when required headers are missing", () => {
    const body = "{}"
    const headers = new Headers()
    expect(verifyDodoWebhook(body, headers)).toBe(false)
  })

  it("rejects when the timestamp is outside the freshness window", () => {
    const body = JSON.stringify({ type: "subscription.active" })
    const id = "wh_old"
    const staleTs = Math.floor(Date.now() / 1000) - 600
    const signedPayload = `${id}.${staleTs}.${body}`
    const key = Buffer.from("test_secret")
    const sig = createHmac("sha256", key).update(signedPayload).digest("base64")
    const headers = new Headers({
      "webhook-id": id,
      "webhook-timestamp": staleTs.toString(),
      "webhook-signature": `v1,${sig}`,
    })
    expect(verifyDodoWebhook(body, headers)).toBe(false)
  })

  it("rejects when the timestamp header is not a number", () => {
    const body = "{}"
    const headers = new Headers({
      "webhook-id": "wh_1",
      "webhook-timestamp": "not-a-number",
      "webhook-signature": "v1,sig",
    })
    expect(verifyDodoWebhook(body, headers)).toBe(false)
  })
})

// ── Subscription Checkout ─────────────────────────────────────────────

describe("Dodo billing — subscription checkout", () => {
  beforeEach(() => {
    resetMockState()
    originalFetch = globalThis.fetch
    fetchCalls = []
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return new Response(
        JSON.stringify({ id: "checkout_1", checkout_url: "https://checkout.example/pro" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )
    }) as typeof fetch
    currentUser = {
      id: "user_1",
      name: "Arka",
      email: "arka@example.com",
      plan: "explore",
      subscriptionStatus: "inactive",
      dodoSubscriptionId: null,
    }
    setDodoEnv("test")
  })

  afterEach(() => {
    clearDodoEnv()
    globalThis.fetch = originalFetch
  })

  it("creates a subscription checkout successfully", async () => {
    const res = await createSubscription("pro")
    const body = (await res.json()) as any
    expect(res.status).toBe(200)
    expect(body.short_url).toBe("https://checkout.example/pro")
    expect(body.id).toBe("checkout_1")
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]?.url).toBe("https://test-api.dodopayments.com/checkouts")
  })

  it("passes the correct product ID and metadata to Dodo", async () => {
    await createSubscription("pro")
    const payload = JSON.parse(String(fetchCalls[0]?.init?.body ?? "{}"))
    expect(payload.product_cart?.[0]?.product_id).toBe("test_pro")
    expect(payload.metadata).toEqual({
      userId: "user_1",
      kind: "subscription",
      plan: "pro",
    })
  })

  it("rejects same-plan active subscription as conflict", async () => {
    currentUser = {
      ...currentUser,
      plan: "pro",
      subscriptionStatus: "active",
      dodoSubscriptionId: "sub_1",
    }
    const res = await createSubscription("pro")
    expect(res.status).toBe(409)
  })

  it("allows upgrading to a different plan", async () => {
    currentUser = {
      ...currentUser,
      plan: "pro",
      subscriptionStatus: "active",
      dodoSubscriptionId: "sub_pro",
    }
    const res = await createSubscription("max")
    expect(res.status).toBe(200)
    const payload = JSON.parse(String(fetchCalls[0]?.init?.body ?? "{}"))
    expect(payload.metadata.isUpgrade).toBe("true")
    expect(payload.metadata.previousPlan).toBe("pro")
  })

  it("returns 400 for an invalid plan", async () => {
    const res = await app().request("/api/billing/create-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "invalid" }),
    })
    expect(res.status).toBe(400)
  })

  it("returns 500 when the product ID is not configured", async () => {
    process.env.DODO_TEST_PRODUCT_PRO = ""
    const res = await createSubscription("pro")
    expect(res.status).toBe(500)
  })

  it("returns 502 when the Dodo API fails", async () => {
    globalThis.fetch = (async () =>
      new Response("Server Error", { status: 500 })) as unknown as typeof fetch
    const res = await createSubscription("pro")
    expect(res.status).toBe(502)
  })
})

// ── Credit Pack Checkout ──────────────────────────────────────────────

describe("Dodo billing — credit pack checkout", () => {
  beforeEach(() => {
    resetMockState()
    originalFetch = globalThis.fetch
    fetchCalls = []
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return new Response(
        JSON.stringify({ id: "pack_checkout_1", checkout_url: "https://checkout.example/pack" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )
    }) as typeof fetch
    currentUser = {
      id: "user_1",
      name: "Arka",
      email: "arka@example.com",
      plan: "pro",
      subscriptionStatus: "active",
      dodoSubscriptionId: "sub_1",
    }
    setDodoEnv("test")
  })

  afterEach(() => {
    clearDodoEnv()
    globalThis.fetch = originalFetch
  })

  it("creates a credit pack checkout successfully", async () => {
    const res = await createCreditPack("credits_500")
    const body = (await res.json()) as any
    expect(res.status).toBe(200)
    expect(body.short_url).toBe("https://checkout.example/pack")
  })

  it("creates checkout metadata for every credit pack", async () => {
    const packs = [
      ["credits_500", "test_500"],
      ["credits_2000", "test_2000"],
      ["credits_6000", "test_6000"],
    ] as const

    for (const [pack, productId] of packs) {
      fetchCalls = []
      const res = await createCreditPack(pack)
      expect(res.status).toBe(200)

      const payload = JSON.parse(String(fetchCalls[0]?.init?.body ?? "{}"))
      expect(payload.product_cart?.[0]?.product_id).toBe(productId)
      expect(payload.metadata).toEqual({
        userId: "user_1",
        kind: "credit_pack",
        productKey: pack,
      })
    }
  })

  it("returns 400 for an invalid pack key", async () => {
    const res = await createCreditPack("invalid_pack")
    expect(res.status).toBe(400)
  })

  it("returns 500 when product ID is not configured for the pack", async () => {
    process.env.DODO_TEST_PRODUCT_CREDITS_500 = ""
    const res = await createCreditPack("credits_500")
    expect(res.status).toBe(500)
  })

  it("blocks Explore plan users from purchasing credit packs", async () => {
    currentUser = {
      ...currentUser,
      plan: "explore",
      subscriptionStatus: "inactive",
      dodoSubscriptionId: null,
    }
    const res = await createCreditPack("credits_500")
    expect(res.status).toBe(403)
  })
})

// ── Cancel Subscription ───────────────────────────────────────────────

describe("Dodo billing — cancel subscription", () => {
  beforeEach(() => {
    resetMockState()
    originalFetch = globalThis.fetch
    fetchCalls = []
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch
    currentUser = {
      id: "user_1",
      name: "Arka",
      email: "arka@example.com",
      plan: "pro",
      subscriptionStatus: "active",
      dodoSubscriptionId: "sub_1",
    }
    setDodoEnv("test")
  })

  afterEach(() => {
    clearDodoEnv()
    globalThis.fetch = originalFetch
  })

  it("cancels via Dodo API and optimistically updates local status", async () => {
    mockState.dbUpdateResult = {}
    const res = await cancelSubscription()
    expect(res.status).toBe(200)
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]?.url).toBe("https://test-api.dodopayments.com/subscriptions/sub_1/cancel")
  })

  it("returns 404 when user has no active subscription", async () => {
    currentUser = { ...currentUser, dodoSubscriptionId: null }
    const res = await cancelSubscription()
    expect(res.status).toBe(404)
  })

  it("returns 502 when the Dodo cancel API fails", async () => {
    globalThis.fetch = (async () =>
      new Response("Error", { status: 500 })) as unknown as typeof fetch
    const res = await cancelSubscription()
    expect(res.status).toBe(502)
  })
})

// ── Subscription Summary ──────────────────────────────────────────────

describe("Dodo billing — subscription summary", () => {
  beforeEach(() => {
    resetMockState()
    currentUser = {
      id: "user_1",
      name: "Arka",
      email: "arka@example.com",
      plan: "pro",
      subscriptionStatus: "active",
      dodoSubscriptionId: "sub_1",
    }
  })

  it("returns credit balance, packs, and sanitized credit totals", async () => {
    const usageAt = new Date("2026-06-16T10:30:00Z")
    mockState.connectedProviders = ["github", "slack"]
    mockState.creditSummary = {
      balance: 497,
      lifetimeGranted: 3000,
      lifetimeConsumed: 503,
      lifetimeRefunded: 0,
      expiringSoon: 25,
      expiringSoonAt: new Date("2026-06-20T00:00:00Z"),
    }
    mockState.recentCreditTransactions = [
      {
        id: "tx_consume_1",
        type: "consume",
        amount: -1,
        balanceAfter: 497,
        reason: "chat usage",
        usageEventId: "usage_123456789",
        usageKind: "request_chat",
        usageCreditsCharged: 1,
        usageCreatedAt: usageAt,
        createdAt: usageAt,
      },
      {
        id: "tx_grant_1",
        type: "grant",
        amount: 500,
        balanceAfter: 500,
        reason: "500 credits purchase",
        usageEventId: null,
        usageKind: null,
        usageCreditsCharged: null,
        usageCreatedAt: null,
        createdAt: new Date("2026-06-16T10:00:00Z"),
      },
    ]
    mockState.dbSelectQueue = [
      [
        {
          id: "user_1",
          name: "Arka",
          email: "arka@example.com",
          createdAt: new Date("2026-06-01T00:00:00Z"),
          role: "user",
          plan: "pro",
          subscriptionStatus: "active",
          trialStartDate: null,
          trialEndDate: null,
          currentPeriodEnd: new Date("2026-07-01T00:00:00Z"),
          dodoSubscriptionId: "sub_1",
          trialInteractionUsed: 0,
          trialInteractionLimit: 100,
          dailyChatCount: 2,
          dailyVoiceCount: 1,
          dailyImageCount: 0,
        },
      ],
      [{ inputTokens: 100, outputTokens: 50 }],
      [
        { kind: "request_chat", count: 2 },
        { kind: "request_voice", count: 1 },
        { kind: "analyze", count: 1 },
        { kind: "bot_message", count: 1 },
      ],
      [
        { kind: "request_chat", creditsCharged: 2 },
        { kind: "analyze", creditsCharged: 1 },
      ],
    ]

    const res = await getSubscription()
    const body = (await res.json()) as any

    expect(res.status).toBe(200)
    expect(body.plan).toBe("pro")
    expect(body.status).toBe("active")
    expect(body.credits.balance).toBe(497)
    expect(body.creditConsumption).toBeUndefined()
    expect(body.creditPacks.map((pack: any) => pack.key)).toEqual([
      "credits_500",
      "credits_2000",
      "credits_6000",
    ])
    expect(body.creditTransactions).toBeUndefined()
  })

  it("returns sanitized usage summary for the dashboard", async () => {
    const usageAt = new Date("2026-06-16T10:30:00Z")
    mockState.creditSummary = {
      balance: 497,
      lifetimeGranted: 3000,
      lifetimeConsumed: 503,
      lifetimeRefunded: 0,
      expiringSoon: 25,
      expiringSoonAt: new Date("2026-06-20T00:00:00Z"),
    }
    mockState.recentCreditTransactions = [
      {
        id: "tx_consume_1",
        type: "consume",
        amount: -1,
        balanceAfter: 497,
        reason: "chat usage",
        usageEventId: "usage_123456789",
        usageKind: "request_chat",
        usageCreditsCharged: 1,
        usageCreatedAt: usageAt,
        createdAt: usageAt,
      },
      {
        id: "tx_grant_1",
        type: "grant",
        amount: 500,
        balanceAfter: 500,
        reason: "500 credits purchase",
        usageEventId: null,
        usageKind: null,
        usageCreditsCharged: null,
        usageCreatedAt: null,
        createdAt: new Date("2026-06-16T10:00:00Z"),
      },
    ]
    mockState.dbSelectQueue = [[{ creditsCharged: 3 }], [{ date: "2026-06-16", credits: 3 }]]

    const res = await getUsageSummary()
    const body = (await res.json()) as any

    expect(res.status).toBe(200)
    expect(body.credits).toMatchObject({
      remaining: 497,
      included: 300,
      used: 3,
      totalAvailableThisPeriod: 500,
      expiringSoon: 25,
    })
    expect(body.monthlyUsage.days).toEqual([{ date: "2026-06-16", credits: 3 }])
    expect(body.recentActivity[0]).toEqual({
      id: "activity-0-1781605800000",
      label: "Chat",
      category: "chat",
      credits: 1,
      createdAt: usageAt.toISOString(),
    })
    expect(body.recentActivity[1]).toMatchObject({
      label: "Credits Added",
      category: "credits_added",
      credits: 500,
    })
  })

  it("dates the usage summary from the dodo billing period, not the calendar month", async () => {
    currentUser.currentPeriodEnd = new Date("2026-08-14T09:00:00Z")
    mockState.dbSelectQueue = [[{ creditsCharged: 0 }], []]

    const body = (await (await getUsageSummary()).json()) as any

    expect(body.credits.resetKind).toBe("renewal")
    expect(body.credits.resetAt).toBe("2026-08-14T09:00:00.000Z")
  })

  it("dates the usage summary from the explore renewal date for an explore user", async () => {
    currentUser.plan = "explore"
    currentUser.subscriptionStatus = "inactive"
    currentUser.dodoSubscriptionId = null
    currentUser.trialEndDate = new Date("2026-08-13T09:00:00Z")
    mockState.dbSelectQueue = [[{ creditsCharged: 0 }], []]

    const body = (await (await getUsageSummary()).json()) as any

    expect(body.credits.resetKind).toBe("renewal")
    expect(body.credits.resetAt).toBe("2026-08-13T09:00:00.000Z")
  })
})

// ── Webhook Processing ────────────────────────────────────────────────

describe("Dodo billing — webhook processing", () => {
  beforeEach(() => {
    resetMockState()
    currentUser = {
      id: "user_1",
      name: "Arka",
      email: "arka@example.com",
      plan: "explore",
      subscriptionStatus: "inactive",
      dodoSubscriptionId: null,
    }
    setDodoEnv("test")
  })

  afterEach(clearDodoEnv)

  it("returns 400 for an invalid signature", async () => {
    const res = await app().request("/api/billing/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "subscription.active" }),
    })
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid JSON body", async () => {
    const id = "wh_bad"
    const ts = Math.floor(Date.now() / 1000).toString()
    const badBody = "not-json"
    const signedPayload = `${id}.${ts}.${badBody}`
    const sig = createHmac("sha256", Buffer.from("test_secret"))
      .update(signedPayload)
      .digest("base64")
    const res = await app().request("/api/billing/webhook", {
      method: "POST",
      headers: {
        "webhook-id": id,
        "webhook-timestamp": ts,
        "webhook-signature": `v1,${sig}`,
        "Content-Type": "application/json",
      },
      body: badBody,
    })
    expect(res.status).toBe(400)
  })

  it("handles subscription.active: activates plan and grants credits", async () => {
    mockState.recordPaymentEvent = async () => ({ duplicate: false })
    mockState.upsertPaymentRecord = async () => "pay_rec_1"
    const grantCalls: any[] = []
    mockState.grantCredits = async (input: any) => {
      grantCalls.push(input)
      return { granted: true, balance: 300 }
    }

    const body = {
      type: "subscription.active",
      data: {
        subscription_id: "dodo_sub_1",
        customer_id: "dodo_cus_1",
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        metadata: { userId: "user_1", kind: "subscription", plan: "pro" },
      },
    }

    const res = await sendWebhook(body)
    expect(res.status).toBe(200)

    // Should have granted monthly credits
    expect(grantCalls.length).toBe(1)
    expect(grantCalls[0]?.amount).toBe(300)
    expect(grantCalls[0]?.source).toBe("subscription_cycle")
  })

  it("grants the correct included credits for every paid subscription plan", async () => {
    const plans = [
      ["pro", 300],
      ["max", 750],
    ] as const

    for (const [plan, includedCredits] of plans) {
      const grantCalls: any[] = []
      mockState.grantCredits = async (input: any) => {
        grantCalls.push(input)
        return { granted: true, balance: includedCredits }
      }

      const body = {
        type: "subscription.active",
        data: {
          subscription_id: `dodo_sub_${plan}`,
          customer_id: "dodo_cus_1",
          current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
          metadata: { userId: "user_1", kind: "subscription", plan },
        },
      }

      const res = await sendWebhook(body)
      expect(res.status).toBe(200)
      expect(grantCalls).toHaveLength(1)
      expect(grantCalls[0]).toMatchObject({
        amount: includedCredits,
        source: "subscription_cycle",
        reason: `${plan === "pro" ? "Pro" : "Max"} monthly credits`,
        metadata: { provider: "dodo", plan },
      })
    }
  })

  it("detects upgrades and cancels the old Dodo subscription", async () => {
    mockState.recordPaymentEvent = async () => ({ duplicate: false })
    mockState.upsertPaymentRecord = async () => "pay_rec_2"

    // Simulate user currently on Pro in the database lookup
    mockState.dbSelectResult = [{ plan: "pro", dodoSubscriptionId: "old_sub_pro" }]

    // Track Dodo API calls after fetch mock setup
    const dodoCalls: string[] = []
    originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      dodoCalls.push(String(input))
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch

    const body = {
      type: "subscription.active",
      data: {
        subscription_id: "new_sub_max",
        customer_id: "dodo_cus_1",
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        metadata: { userId: "user_1", kind: "subscription", plan: "max" },
      },
    }

    const res = await sendWebhook(body)
    expect(res.status).toBe(200)

    // Should cancel the old Pro subscription in Dodo
    expect(dodoCalls.some((url) => url.includes("old_sub_pro"))).toBe(true)

    globalThis.fetch = originalFetch
  })

  it("handles subscription.cancelled: resets user to explore", async () => {
    mockState.recordPaymentEvent = async () => ({ duplicate: false })
    mockState.dbSelectResult = [{ id: "pay_rec_1" }]

    const body = {
      type: "subscription.cancelled",
      data: {
        subscription_id: "dodo_sub_1",
        metadata: { userId: "user_1", kind: "subscription", plan: "pro" },
      },
    }

    const res = await sendWebhook(body)
    expect(res.status).toBe(200)
  })

  it("handles subscription.past_due: marks payment as past due", async () => {
    mockState.recordPaymentEvent = async () => ({ duplicate: false })

    const body = {
      type: "subscription.past_due",
      data: {
        subscription_id: "dodo_sub_1",
        metadata: { userId: "user_1" },
      },
    }

    const res = await sendWebhook(body)
    expect(res.status).toBe(200)
  })

  it("handles payment.succeeded for credit packs: grants credits", async () => {
    mockState.recordPaymentEvent = async () => ({ duplicate: false })
    mockState.upsertPaymentRecord = async () => "pay_rec_credits"
    const grantCalls: any[] = []
    mockState.grantCredits = async (input: any) => {
      grantCalls.push(input)
      return { granted: true, balance: 500 }
    }

    const body = {
      type: "payment.succeeded",
      data: {
        payment_id: "pay_500",
        checkout_id: "checkout_500",
        amount: 499,
        currency: "USD",
        metadata: {
          userId: "user_1",
          kind: "credit_pack",
          productKey: "credits_500",
        },
      },
    }

    const res = await sendWebhook(body)
    expect(res.status).toBe(200)
    expect(grantCalls.length).toBe(1)
    expect(grantCalls[0]?.amount).toBe(500)
    expect(grantCalls[0]?.source).toBe("credit_pack")
  })

  it("grants the correct credits for every credit pack payment", async () => {
    const packs = [
      ["credits_500", 500, "500 credits"],
      ["credits_2000", 2000, "2,000 credits"],
      ["credits_6000", 6000, "6,000 credits"],
    ] as const

    for (const [productKey, credits, name] of packs) {
      const grantCalls: any[] = []
      mockState.grantCredits = async (input: any) => {
        grantCalls.push(input)
        return { granted: true, balance: credits }
      }

      const body = {
        type: "payment.succeeded",
        data: {
          payment_id: `pay_${productKey}`,
          checkout_id: `checkout_${productKey}`,
          amount: 499,
          currency: "USD",
          metadata: {
            userId: "user_1",
            kind: "credit_pack",
            productKey,
          },
        },
      }

      const res = await sendWebhook(body)
      expect(res.status).toBe(200)
      expect(grantCalls).toHaveLength(1)
      expect(grantCalls[0]).toMatchObject({
        amount: credits,
        source: "credit_pack",
        reason: `${name} purchase`,
        metadata: { provider: "dodo", productKey },
      })
    }
  })

  it("deduplicates identical webhook events", async () => {
    mockState.recordPaymentEvent = async () => ({ duplicate: true })

    const body = {
      type: "subscription.active",
      data: { metadata: { userId: "user_1", plan: "pro" } },
    }
    const res = await sendWebhook(body)
    const result = (await res.json()) as any
    expect(result.deduplicated).toBe(true)
  })

  it("finds user by subscription ID when metadata is missing", async () => {
    mockState.recordPaymentEvent = async () => ({ duplicate: false })
    mockState.dbSelectResult = [{ id: "user_1" }]

    // subscription.active event without metadata
    const body = {
      type: "subscription.active",
      data: {
        subscription_id: "dodo_sub_1",
        customer_id: "dodo_cus_1",
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
    }

    const res = await sendWebhook(body)
    expect(res.status).toBe(200)
  })

  it("handles subscription cancellation without metadata by looking up subscription ID", async () => {
    mockState.recordPaymentEvent = async () => ({ duplicate: false })
    mockState.dbSelectResult = [{ id: "user_1" }]

    const body = {
      type: "subscription.cancelled",
      data: {
        subscription_id: "dodo_sub_1",
      },
    }

    const res = await sendWebhook(body)
    expect(res.status).toBe(200)
  })
})
