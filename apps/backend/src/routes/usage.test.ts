import { beforeEach, describe, expect, it, mock } from "bun:test"
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
}

type ReserveBody = {
  ok?: boolean
  code?: string
  plan?: string
  requestsUsed?: number
  requestsLimit?: number | null
  requestsRemaining?: number | null
  resetAt?: string
  dailyChatUsed?: number
  dailyVoiceUsed?: number
}

let currentUser: TestUser
let updateCalls = 0
let mockRequestCount = 0

const fakeDb = {
  update: () => {
    updateCalls++
    return {
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    }
  },
  insert: () => ({
    values: () => Promise.resolve(),
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

mock.module("../auth.js", () => ({
  authenticate: async (c: any, next: () => Promise<void>) => {
    c.set("user", currentUser)
    await next()
  },
}))

const { usageRouter } = await import("./usage.js")

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
    updateCalls = 0
    mockRequestCount = 0
  })

  it("blocks exhausted Explore users with quota_exceeded", async () => {
    mockRequestCount = 100
    const res = await reserve()
    const body = (await res.json()) as ReserveBody

    expect(res.status).toBe(429)
    expect(body.code).toBe("quota_exceeded")
    expect(body.plan).toBe("explore")
  })

  it("blocks inactive Pro users with subscription_inactive", async () => {
    currentUser = user({
      plan: "pro",
      subscriptionStatus: "past_due",
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
