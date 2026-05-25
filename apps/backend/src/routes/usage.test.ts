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
}

type ReserveBody = {
  ok?: boolean
  code?: string
  plan?: string
  trialInteractionUsed?: number
  trialInteractionLimit?: number
  trialInteractionsRemaining?: number
  dailyChatUsed?: number
  dailyVoiceUsed?: number
}

let currentUser: TestUser
let updateRows: unknown[]
let updateCalls = 0

const fakeDb = {
  update: () => {
    updateCalls++
    return {
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(updateRows),
        }),
      }),
    }
  },
  insert: () => ({
    values: () => Promise.resolve(),
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
    trialEndDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    trialInteractionUsed: 0,
    trialInteractionLimit: 150,
    ...overrides,
  }
}

describe("POST /api/usage/interactions/reserve", () => {
  beforeEach(() => {
    currentUser = user()
    updateRows = []
    updateCalls = 0
  })

  it("reserves the final Explore interaction", async () => {
    currentUser = user({ trialInteractionUsed: 149 })
    updateRows = [{ plan: "explore", trialInteractionUsed: 150, trialInteractionLimit: 150 }]

    const res = await reserve()
    const body = await res.json() as ReserveBody

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, plan: "explore", trialInteractionUsed: 150, trialInteractionLimit: 150, trialInteractionsRemaining: 0 })
    expect(updateCalls).toBe(1)
  })

  it("returns the updated Explore count for immediate desktop refresh", async () => {
    currentUser = user({ trialInteractionUsed: 41 })
    updateRows = [{ plan: "explore", trialInteractionUsed: 42, trialInteractionLimit: 150 }]

    const res = await reserve()
    const body = await res.json() as ReserveBody

    expect(res.status).toBe(200)
    expect(body.plan).toBe("explore")
    expect(body.trialInteractionUsed).toBe(42)
    expect(body.trialInteractionLimit).toBe(150)
    expect(body.trialInteractionsRemaining).toBe(108)
  })

  it("rejects Explore after the interaction pool is exhausted", async () => {
    currentUser = user({ trialInteractionUsed: 150 })

    const res = await reserve()
    const body = await res.json() as ReserveBody

    expect(res.status).toBe(429)
    expect(body.code).toBe("interaction_limit_reached")
    expect(updateCalls).toBe(1)
  })

  it("rejects an expired Explore trial", async () => {
    currentUser = user({ trialEndDate: new Date(Date.now() - 1000) })

    const res = await reserve()
    const body = await res.json() as ReserveBody

    expect(res.status).toBe(403)
    expect(body.code).toBe("trial_expired")
    expect(updateCalls).toBe(0)
  })

  it("allows active Pro without consuming Explore interactions", async () => {
    currentUser = user({ plan: "pro", subscriptionStatus: "active", trialInteractionUsed: 12 })
    updateRows = [{
      plan: "pro",
      trialInteractionUsed: 12,
      trialInteractionLimit: 150,
      dailyChatUsed: 1,
      dailyVoiceUsed: 0,
    }]

    const res = await reserve()
    const body = await res.json() as ReserveBody

    expect(res.status).toBe(200)
    expect(body.trialInteractionUsed).toBe(12)
    expect(body.dailyChatUsed).toBe(1)
    expect(updateCalls).toBe(1)
  })

  it("gives owner accounts effective Max access even when stored as Explore", async () => {
    currentUser = user({ role: "owner", plan: "explore", trialInteractionUsed: 12 })

    const res = await reserve()
    const body = await res.json() as ReserveBody

    expect(res.status).toBe(200)
    expect(body.plan).toBe("max")
    expect(body.trialInteractionUsed).toBe(12)
    expect(body.trialInteractionsRemaining).toBe(138)
    expect(updateCalls).toBe(0)
  })

  it("gives allowlisted owner emails effective Max access", async () => {
    currentUser = user({ email: "arkagarai292@gmail.com", plan: "explore", trialInteractionUsed: 12 })

    const res = await reserve()
    const body = await res.json() as ReserveBody

    expect(res.status).toBe(200)
    expect(body.plan).toBe("max")
    expect(body.trialInteractionUsed).toBe(12)
    expect(body.trialInteractionsRemaining).toBe(138)
    expect(updateCalls).toBe(0)
  })

  it("rejects normal Max users while Max is unavailable", async () => {
    currentUser = user({ plan: "max", subscriptionStatus: "active" })

    const res = await reserve("chat")
    const body = await res.json() as ReserveBody

    expect(res.status).toBe(403)
    expect(body.code).toBe("plan_unavailable")
    expect(updateCalls).toBe(0)
  })

  it("reserves the final Pro chat turn", async () => {
    currentUser = user({ plan: "pro", subscriptionStatus: "active" })
    updateRows = [{
      plan: "pro",
      trialInteractionUsed: 0,
      trialInteractionLimit: 150,
      dailyChatUsed: 10000,
      dailyVoiceUsed: 0,
    }]

    const res = await reserve("chat")
    const body = await res.json() as ReserveBody

    expect(res.status).toBe(200)
    expect(body.dailyChatUsed).toBe(10000)
    expect(updateCalls).toBe(1)
  })

  it("rejects Pro chat after the daily cap", async () => {
    currentUser = user({ plan: "pro", subscriptionStatus: "active" })

    const res = await reserve("chat")
    const body = await res.json() as ReserveBody

    expect(res.status).toBe(429)
    expect(body.code).toBe("rate_limited")
    expect(updateCalls).toBe(1)
  })

  it("reserves the final Pro voice turn", async () => {
    currentUser = user({ plan: "pro", subscriptionStatus: "active" })
    updateRows = [{
      plan: "pro",
      trialInteractionUsed: 0,
      trialInteractionLimit: 150,
      dailyChatUsed: 0,
      dailyVoiceUsed: 200,
    }]

    const res = await reserve("voice")
    const body = await res.json() as ReserveBody

    expect(res.status).toBe(200)
    expect(body.dailyVoiceUsed).toBe(200)
    expect(updateCalls).toBe(1)
  })

  it("rejects Pro voice after the daily cap", async () => {
    currentUser = user({ plan: "pro", subscriptionStatus: "active" })

    const res = await reserve("voice")
    const body = await res.json() as ReserveBody

    expect(res.status).toBe(429)
    expect(body.code).toBe("rate_limited")
    expect(updateCalls).toBe(1)
  })

  it("rejects inactive Pro subscriptions", async () => {
    currentUser = user({ plan: "pro", subscriptionStatus: "past_due" })

    const res = await reserve("chat")
    const body = await res.json() as ReserveBody

    expect(res.status).toBe(403)
    expect(body.code).toBe("subscription_required")
    expect(updateCalls).toBe(0)
  })

  it("rejects unknown active plans instead of falling back to Pro limits", async () => {
    currentUser = user({ plan: "enterprise", subscriptionStatus: "active" })

    const res = await reserve("chat")
    const body = await res.json() as ReserveBody

    expect(res.status).toBe(403)
    expect(body.code).toBe("invalid_plan")
    expect(updateCalls).toBe(0)
  })

  it("resets stale paid daily counters and counts the requested kind", async () => {
    currentUser = user({ plan: "pro", subscriptionStatus: "active" })
    updateRows = [{
      plan: "pro",
      trialInteractionUsed: 0,
      trialInteractionLimit: 150,
      dailyChatUsed: 0,
      dailyVoiceUsed: 1,
    }]

    const res = await reserve("voice")
    const body = await res.json() as ReserveBody

    expect(res.status).toBe(200)
    expect(body.dailyChatUsed).toBe(0)
    expect(body.dailyVoiceUsed).toBe(1)
    expect(updateCalls).toBe(1)
  })
})
