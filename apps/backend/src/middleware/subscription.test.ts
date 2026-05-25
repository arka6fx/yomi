import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"

type TestUser = {
  id: string
  role: string
  plan: string
  subscriptionStatus: string
  trialEndDate: Date | null
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
}

mock.module("@yomi/db", () => ({ db: fakeDb, usageEvents: {} }))

const { requireAccess } = await import("./subscription.js")

function user(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: "user_1",
    role: "user",
    plan: "explore",
    subscriptionStatus: "inactive",
    trialEndDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ...overrides,
  }
}

function app(kind: "chat" | "voice" | "agent") {
  const hono = new Hono()
  hono.get("/", async (c, next) => {
    c.set("user", currentUser as any)
    return requireAccess(kind)(c, next)
  }, (c) => c.json({ ok: true }))
  return hono
}

describe("requireAccess", () => {
  beforeEach(() => {
    currentUser = user()
    updateRows = []
    updateCalls = 0
  })

  it("atomically reserves an Explore chat interaction before allowing access", async () => {
    updateRows = [{ id: "user_1" }]

    const res = await app("chat").request("/")

    expect(res.status).toBe(200)
    expect(updateCalls).toBe(1)
  })

  it("blocks Explore agents without consuming an interaction", async () => {
    const res = await app("agent").request("/")
    const body = await res.json() as { code?: string }

    expect(res.status).toBe(403)
    expect(body.code).toBe("upgrade_required")
    expect(updateCalls).toBe(0)
  })

  it("blocks paid users at the daily cap when the atomic reservation fails", async () => {
    currentUser = user({ plan: "pro", subscriptionStatus: "active" })

    const res = await app("voice").request("/")
    const body = await res.json() as { code?: string }

    expect(res.status).toBe(429)
    expect(body.code).toBe("rate_limited")
    expect(updateCalls).toBe(1)
  })

  it("rejects unknown active plans instead of falling back to Pro limits", async () => {
    currentUser = user({ plan: "enterprise", subscriptionStatus: "active" })

    const res = await app("chat").request("/")
    const body = await res.json() as { code?: string }

    expect(res.status).toBe(403)
    expect(body.code).toBe("invalid_plan")
    expect(updateCalls).toBe(0)
  })

  it("lets owners bypass unavailable Max checks", async () => {
    currentUser = user({ role: "owner", plan: "max", subscriptionStatus: "active" })

    const res = await app("agent").request("/")

    expect(res.status).toBe(200)
    expect(updateCalls).toBe(0)
  })
})
