import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"

type TestUser = {
  id: string
}

let currentUser: TestUser
let updateRows: unknown[]
let updatePayload: unknown
let updateCalls = 0

const fakeDb = {
  update: () => {
    updateCalls++
    return {
      set: (payload: unknown) => {
        updatePayload = payload
        return {
          where: () => ({
            returning: () => Promise.resolve(updateRows),
          }),
        }
      },
    }
  },
}

mock.module("@yomi/db", () => ({ db: fakeDb }))

mock.module("../auth.js", () => ({
  authenticate: async (c: any, next: () => Promise<void>) => {
    c.set("user", currentUser)
    await next()
  },
}))

const { profileRouter } = await import("./profile.js")

function app() {
  const hono = new Hono()
  hono.route("/api/user", profileRouter)
  return hono
}

function updateName(name: string) {
  return app().request("/api/user/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  })
}

describe("PATCH /api/user/profile", () => {
  beforeEach(() => {
    currentUser = { id: "user_1" }
    updateRows = []
    updatePayload = null
    updateCalls = 0
  })

  it("updates the authenticated user's trimmed display name", async () => {
    updateRows = [{ name: "Arka", email: "arka@example.com" }]

    const res = await updateName("  Arka  ")
    const body = await res.json() as { name?: string; email?: string }

    expect(res.status).toBe(200)
    expect(updatePayload).toEqual({ name: "Arka" })
    expect(body).toEqual({ name: "Arka", email: "arka@example.com" })
    expect(updateCalls).toBe(1)
  })

  it("rejects empty display names", async () => {
    const res = await updateName("   ")
    const body = await res.json() as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_name")
    expect(updateCalls).toBe(0)
  })
})
