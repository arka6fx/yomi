import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"

type TestUser = {
  id: string
  email: string
  role: string
  plan: string
  subscriptionStatus: string
  trialEndDate: Date | null
  trialInteractionUsed: number
  trialInteractionLimit: number
  dailyChatCount: number
  dailyVoiceCount: number
  currentPeriodEnd: Date | null
}

type ReserveBody = {
  ok?: boolean
  code?: string
  plan?: string
  creditsRemaining?: number
  requestsUsed?: number
  requestsLimit?: number | null
  requestsRemaining?: number | null
  resetAt?: string
  dailyChatUsed?: number
  dailyVoiceUsed?: number
}

let currentUser: TestUser
let mockRequestCount = 0

const fakeDb = {
  update: () => {
    return {
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    }
  },
  insert: () => ({
    values: () => ({
      returning: () => Promise.resolve([{ id: "usage_1" }]),
    }),
  }),
  select: () => ({
    from: () => ({
      where: () => Promise.resolve([{ count: mockRequestCount }]),
    }),
  }),
}

mock.module("@yomi/db", () => ({
  db: fakeDb,
  usageEvents: {},
}))

mock.module("../services/credit-ledger.js", () => ({
  getCreditSummary: async () => ({
    balance: 0,
    lifetimeGranted: 0,
    lifetimeConsumed: 0,
    lifetimeRefunded: 0,
    expiringSoon: 0,
    expiringSoonAt: null,
  }),
  consumeCredits: async () => ({
    ok: false,
    charged: 0,
    balance: 0,
    insufficient: true,
  }),
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

function reserve(kind: "chat" | "voice" = "chat") {
  return app().request("/api/usage/interactions/reserve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind }),
  })
}

function user(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: "user_1",
    email: "user@example.com",
    role: "user",
    plan: "explore",
    subscriptionStatus: "inactive",
    trialEndDate: null,
    currentPeriodEnd: null,
    trialInteractionUsed: 100,
    trialInteractionLimit: 100,
    dailyChatCount: 10000,
    dailyVoiceCount: 200,
    ...overrides,
  }
}

describe("POST /api/usage/interactions/reserve", () => {
  beforeEach(() => {
    currentUser = user()
    mockRequestCount = 0
  })

  it("blocks exhausted Explore users without credits", async () => {
    mockRequestCount = 100
    const res = await reserve()
    const body = (await res.json()) as ReserveBody

    expect(res.status).toBe(402)
    expect(body.code).toBe("insufficient_credits")
    expect(body.plan).toBe("explore")
    expect(body.creditsRemaining).toBe(0)
  })

  it("blocks inactive Pro users with subscription_inactive", async () => {
    currentUser = user({
      plan: "pro",
      subscriptionStatus: "past_due",
      currentPeriodEnd: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      trialInteractionUsed: 12,
      dailyChatCount: 345,
      dailyVoiceCount: 67,
    })

    const res = await reserve("voice")
    const body = (await res.json()) as ReserveBody

    expect(res.status).toBe(402)
    expect(body.code).toBe("subscription_inactive")
    expect(body.plan).toBe("pro")
  })

  it("allows Max with active subscription", async () => {
    currentUser = user({ plan: "max", subscriptionStatus: "active" })

    const res = await reserve("chat")
    const body = (await res.json()) as ReserveBody

    expect(res.status).toBe(200)
    expect(body.plan).toBe("max")
    expect(body.ok).toBe(true)
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
