import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"

type TestUser = {
  id: string
  name?: string | null
  email?: string | null
  plan: string
  subscriptionStatus: string
  dodoSubscriptionId: string | null
}

type FetchCall = {
  url: string
  init?: RequestInit
}

let currentUser: TestUser
let originalFetch: typeof fetch
let fetchCalls: FetchCall[] = []

const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([]),
      }),
    }),
  }),
  update: () => ({
    set: () => ({
      where: () => Promise.resolve({}),
    }),
  }),
  insert: () => ({
    values: () => ({
      returning: () => Promise.resolve([]),
    }),
  }),
}

mock.module("@yomi/db", () => ({
  db: fakeDb,
  usageEvents: {},
}))

mock.module("../auth.js", () => ({
  authenticate: async (c: any, next: () => Promise<void>) => {
    c.set("user", currentUser)
    await next()
  },
}))

mock.module("../services/credit-ledger.js", () => ({
  createPaymentRecord: async () => "payment_1",
  getCreditSummary: async () => ({
    balance: 0,
    lifetimeGranted: 0,
    lifetimeConsumed: 0,
    lifetimeRefunded: 0,
    expiringSoon: 0,
    expiringSoonAt: null,
  }),
  grantCredits: async () => ({ ok: true }),
  recentCreditTransactions: async () => [],
}))

mock.module("../services/payment-events.js", () => ({
  payloadHash: () => "hash_1",
  recordPaymentEvent: async () => ({ duplicate: false }),
}))

const { billingRouter, getDodoConfig } = await import("./billing.js")

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
  delete process.env.DODO_ENV
  delete process.env.DODO_TEST_API_KEY
  delete process.env.DODO_TEST_WEBHOOK_SECRET
  delete process.env.DODO_TEST_API_BASE
  delete process.env.DODO_TEST_PRODUCT_PRO
  delete process.env.DODO_TEST_PRODUCT_MAX
  delete process.env.DODO_TEST_PRODUCT_CREDITS_500
  delete process.env.DODO_TEST_PRODUCT_CREDITS_2000
  delete process.env.DODO_TEST_PRODUCT_CREDITS_6000
  delete process.env.DODO_LIVE_API_KEY
  delete process.env.DODO_LIVE_WEBHOOK_SECRET
  delete process.env.DODO_LIVE_API_BASE
  delete process.env.DODO_LIVE_PRODUCT_PRO
  delete process.env.DODO_LIVE_PRODUCT_MAX
  delete process.env.DODO_LIVE_PRODUCT_CREDITS_500
  delete process.env.DODO_LIVE_PRODUCT_CREDITS_2000
  delete process.env.DODO_LIVE_PRODUCT_CREDITS_6000
}

function createSubscription(plan: "pro" | "max") {
  return app().request("/api/billing/create-subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  })
}

describe("Dodo billing setup", () => {
  beforeEach(() => {
    currentUser = {
      id: "user_1",
      name: "Arka",
      email: "arka@example.com",
      plan: "explore",
      subscriptionStatus: "inactive",
      dodoSubscriptionId: null,
    }
    fetchCalls = []
    originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      fetchCalls.push({
        url: String(input),
        init,
      })

      return new Response(
        JSON.stringify({
          id: "checkout_1",
          checkout_url: "https://checkout.example/test",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )
    }) as typeof fetch
  })

  afterEach(() => {
    clearDodoEnv()
    globalThis.fetch = originalFetch
  })

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

  it("creates checkout sessions with the selected Dodo mode", async () => {
    setDodoEnv("test")

    const res = await createSubscription("pro")
    const body = (await res.json()) as { short_url?: string; error?: string }

    expect(res.status).toBe(200)
    expect(body.short_url).toBe("https://checkout.example/test")
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]?.url).toBe("https://test-api.dodopayments.com/checkouts")
    expect(fetchCalls[0]?.init?.headers).toEqual({
      Authorization: "Bearer test_key",
      "Content-Type": "application/json",
    })

    const payload = JSON.parse(String(fetchCalls[0]?.init?.body ?? "{}")) as {
      product_cart?: { product_id?: string; quantity?: number }[]
      metadata?: Record<string, string>
    }
    expect(payload.product_cart?.[0]?.product_id).toBe("test_pro")
    expect(payload.metadata).toEqual({
      userId: "user_1",
      kind: "subscription",
      plan: "pro",
    })
  })
})
