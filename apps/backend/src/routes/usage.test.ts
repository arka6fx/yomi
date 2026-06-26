import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"

type TestUser = {
  id: string
  email: string
  role: string
  plan: string
  subscriptionStatus: string
  trialEndDate: Date | null
  currentPeriodEnd: Date | null
}

type ReserveBody = {
  ok?: boolean
  code?: string
  plan?: string
  paidBy?: string
  creditsRequired?: number
  creditsCharged?: number
  creditsRemaining?: number
  resetAt?: string
  usageWarning?: string
}

let currentUser: TestUser
let mockCreditBalance = 0
const activeTrialEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

// Minimal db stub: inserts return an id, updates are no-ops. Credit logic lives in the
// mocked credit-ledger below, which is what the metering helper actually gates on.
const fakeDb = {
  update: () => ({
    set: () => ({
      where: () => Promise.resolve([]),
    }),
  }),
  insert: () => ({
    values: () => ({
      returning: () => Promise.resolve([{ id: "usage_1" }]),
    }),
  }),
}

mock.module("@yomi/db", () => ({
  db: fakeDb,
  usageEvents: {},
}))

mock.module("../services/credit-ledger.js", () => ({
  getCreditSummary: async () => ({
    balance: mockCreditBalance,
    lifetimeGranted: 0,
    lifetimeConsumed: 0,
    lifetimeRefunded: 0,
    expiringSoon: 0,
    expiringSoonAt: null,
  }),
  // Honour the requested amount so creditsRequired/creditsCharged line up, and only
  // succeed when the (mocked) balance can cover it — mirrors the real ledger guard.
  consumeCredits: async (input: { amount: number }) => {
    if (mockCreditBalance < input.amount) {
      return { ok: false, charged: 0, balance: mockCreditBalance, insufficient: true }
    }
    return { ok: true, charged: input.amount, balance: mockCreditBalance - input.amount }
  },
  expireCredits: async () => 0,
}))

mock.module("../auth.js", () => ({
  authenticate: async (c: any, next: () => Promise<void>) => {
    c.set("user", currentUser)
    await next()
  },
}))

let usageRouter: import("hono").Hono

beforeAll(async () => {
  usageRouter = (await import("./usage.js")).usageRouter
})

function app() {
  const hono = new Hono()
  hono.route("/api/usage", usageRouter)
  return hono
}

function reserve(kind: "chat" | "voice" | "analyze" | "bot_message" = "chat", duration?: number) {
  return app().request("/api/usage/interactions/reserve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(duration !== undefined ? { kind, duration } : { kind }),
  })
}

function user(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: "user_1",
    email: "user@example.com",
    role: "user",
    plan: "explore",
    subscriptionStatus: "inactive",
    trialEndDate: activeTrialEndDate,
    currentPeriodEnd: null,
    ...overrides,
  }
}

describe("POST /api/usage/interactions/reserve", () => {
  beforeEach(() => {
    currentUser = user()
    mockCreditBalance = 0
  })

  it("blocks Explore trial users with 0 credits (must subscribe)", async () => {
    mockCreditBalance = 0
    for (const kind of ["chat", "voice", "analyze", "bot_message"] as const) {
      const res = await reserve(kind)
      const body = (await res.json()) as ReserveBody
      expect(res.status).toBe(402)
      expect(body.code).toBe("subscription_required")
      expect(body.plan).toBe("explore")
    }
  })

  it("allows Explore trial users with credits and consumes them", async () => {
    mockCreditBalance = 10
    const res = await reserve("chat")
    const body = (await res.json()) as ReserveBody
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.plan).toBe("explore")
    expect(body.paidBy).toBe("credits")
    expect(body.creditsRequired).toBe(1)
    expect(body.creditsRemaining).toBe(9)
  })

  it("blocks expired Explore trial users with subscription_inactive", async () => {
    currentUser = user({ trialEndDate: new Date(Date.now() - 1000) })
    mockCreditBalance = 100
    const res = await reserve()
    const body = (await res.json()) as ReserveBody
    expect(res.status).toBe(402)
    expect(body.code).toBe("subscription_inactive")
    expect(body.plan).toBe("explore")
  })

  it("blocks past_due Pro users beyond grace with subscription_inactive", async () => {
    currentUser = user({
      plan: "pro",
      subscriptionStatus: "past_due",
      currentPeriodEnd: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    })
    mockCreditBalance = 100
    const res = await reserve("voice")
    const body = (await res.json()) as ReserveBody
    expect(res.status).toBe(402)
    expect(body.code).toBe("subscription_inactive")
    expect(body.plan).toBe("pro")
  })

  it("blocks active Pro users with 0 credits (buy a pack)", async () => {
    currentUser = user({ plan: "pro", subscriptionStatus: "active" })
    mockCreditBalance = 0
    const res = await reserve("chat")
    const body = (await res.json()) as ReserveBody
    expect(res.status).toBe(402)
    expect(body.code).toBe("credits_exhausted")
    expect(body.plan).toBe("pro")
  })

  it("allows Max with active subscription and credits", async () => {
    currentUser = user({ plan: "max", subscriptionStatus: "active" })
    mockCreditBalance = 50
    const res = await reserve("chat")
    const body = (await res.json()) as ReserveBody
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.plan).toBe("max")
  })

  it("charges voice per minute using the reported duration", async () => {
    currentUser = user({ plan: "pro", subscriptionStatus: "active" })
    mockCreditBalance = 50
    const res = await reserve("voice", 120) // 2 minutes -> 4 credits
    const body = (await res.json()) as ReserveBody
    expect(res.status).toBe(200)
    expect(body.creditsRequired).toBe(4)
    expect(body.creditsRemaining).toBe(46)
  })

  it("lets owners through with 0 credits (bypass)", async () => {
    currentUser = user({ email: "owner@example.com" })
    mockCreditBalance = 0
    const res = await reserve("chat")
    const body = (await res.json()) as ReserveBody
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.paidBy).toBe("owner")
  })

  it("rejects invalid kind", async () => {
    const res = await app().request("/api/usage/interactions/reserve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "invalid_kind" }),
    })
    const body = (await res.json()) as ReserveBody
    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_usage_kind")
  })
})
