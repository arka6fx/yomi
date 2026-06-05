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

  it("allows Pro voice even when the subscription is inactive", async () => {
    currentUser = user({ plan: "pro", subscriptionStatus: "past_due" })

    const res = await app("voice").request("/")

    expect(res.status).toBe(200)
  })

  it("allows Max agents while testing unrestricted plans", async () => {
    currentUser = user({ plan: "max", subscriptionStatus: "active" })

    const res = await app("agent").request("/")

    expect(res.status).toBe(200)
  })
})
