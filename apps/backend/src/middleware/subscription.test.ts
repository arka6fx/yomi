import { beforeEach, describe, expect, it } from "bun:test"
import { Hono } from "hono"

type TestUser = {
  id: string
  email: string
  role: string
  plan: string
  subscriptionStatus: string
  trialEndDate: Date | null
}

let currentUser: TestUser

const { requireAccess } = await import("./subscription.js")

function user(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: "user_1",
    email: "user@example.com",
    role: "user",
    plan: "explore",
    subscriptionStatus: "inactive",
    trialEndDate: null,
    ...overrides,
  }
}

function app(kind: "chat" | "voice" | "agent") {
  const hono = new Hono()
  hono.get(
    "/",
    async (c, next) => {
      c.set("user", currentUser as any)
      return requireAccess(kind)(c, next)
    },
    (c) => c.json({ ok: true }),
  )
  return hono
}

describe("requireAccess", () => {
  beforeEach(() => {
    currentUser = user()
  })

  it("allows Explore chat without quota checks", async () => {
    const res = await app("chat").request("/")

    expect(res.status).toBe(200)
  })

  it("allows Explore voice", async () => {
    const res = await app("voice").request("/")

    expect(res.status).toBe(200)
  })

  it("allows Explore agent (now includes limited desktop automation)", async () => {
    const res = await app("agent").request("/")

    expect(res.status).toBe(200)
  })

  it("blocks Pro past_due on voice", async () => {
    currentUser = user({ plan: "pro", subscriptionStatus: "past_due" })

    const res = await app("voice").request("/")
    const body = await res.json() as { code?: string }

    expect(res.status).toBe(402)
    expect(body.code).toBe("subscription_inactive")
  })

  it("blocks Pro past_due on chat", async () => {
    currentUser = user({ plan: "pro", subscriptionStatus: "past_due" })

    const res = await app("chat").request("/")
    const body = await res.json() as { code?: string }

    expect(res.status).toBe(402)
    expect(body.code).toBe("subscription_inactive")
  })

  it("blocks Pro past_due on agent", async () => {
    currentUser = user({ plan: "pro", subscriptionStatus: "past_due" })

    const res = await app("agent").request("/")
    const body = await res.json() as { code?: string }

    expect(res.status).toBe(402)
    expect(body.code).toBe("subscription_inactive")
  })

  it("allows Max active on agent", async () => {
    currentUser = user({ plan: "max", subscriptionStatus: "active" })

    const res = await app("agent").request("/")

    expect(res.status).toBe(200)
  })

  it("allows Pro active on voice", async () => {
    currentUser = user({ plan: "pro", subscriptionStatus: "active" })

    const res = await app("voice").request("/")

    expect(res.status).toBe(200)
  })
})
