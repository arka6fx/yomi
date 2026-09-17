import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"

type TestUser = {
  id: string
  agentSoul?: string | null
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

let handleResult: { ok: true; leaderboardHandle: string } | { ok: false; error: string } = {
  ok: true,
  leaderboardHandle: "arka",
}
let showPhotoResult = { leaderboardShowPhoto: true }
mock.module("../services/streaks.js", () => ({
  updateLeaderboardHandle: async () => handleResult,
  setLeaderboardShowPhoto: async () => showPhotoResult,
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

function updateProfile(body: Record<string, unknown>) {
  return app().request("/api/user/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function postHandle(handle: unknown) {
  return app().request("/api/user/handle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle }),
  })
}

function postShowPhoto(showPhoto: unknown) {
  return app().request("/api/user/show-photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ showPhoto }),
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
    const body = (await res.json()) as { name?: string; email?: string }

    expect(res.status).toBe(200)
    expect(updatePayload).toEqual({ name: "Arka" })
    expect(body).toEqual({ name: "Arka", email: "arka@example.com" })
    expect(updateCalls).toBe(1)
  })

  it("rejects empty display names", async () => {
    const res = await updateName("   ")
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_name")
    expect(updateCalls).toBe(0)
  })

  it("updates agentSoul alone, without requiring name", async () => {
    updateRows = [{ name: "Arka", email: "arka@example.com", agentSoul: "be terse" }]

    const res = await updateProfile({ agentSoul: "be terse" })
    const body = (await res.json()) as { agentSoul?: string }

    expect(res.status).toBe(200)
    expect(updatePayload).toEqual({ agentSoul: "be terse" })
    expect(body.agentSoul).toBe("be terse")
  })

  it("updates name and agentSoul together", async () => {
    updateRows = [{ name: "Arka", email: "arka@example.com", agentSoul: "be terse" }]

    await updateProfile({ name: "Arka", agentSoul: "be terse" })

    expect(updatePayload).toEqual({ name: "Arka", agentSoul: "be terse" })
  })

  it("rejects a request with neither name nor agentSoul", async () => {
    const res = await updateProfile({})
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_body")
    expect(updateCalls).toBe(0)
  })

  it("rejects an agentSoul longer than 2000 characters", async () => {
    const res = await updateProfile({ agentSoul: "a".repeat(2001) })
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_agent_soul")
    expect(updateCalls).toBe(0)
  })
})

describe("GET /api/user/me", () => {
  beforeEach(() => {
    currentUser = { id: "user_1", agentSoul: "be terse" }
  })

  it("includes agentSoul in the response", async () => {
    const res = await app().request("/api/user/me", {
      headers: { Authorization: "Bearer test" },
    })
    const body = (await res.json()) as { agentSoul?: string | null }

    expect(res.status).toBe(200)
    expect(body.agentSoul).toBe("be terse")
  })
})

describe("POST /api/user/handle", () => {
  beforeEach(() => {
    currentUser = { id: "user_1" }
    handleResult = { ok: true, leaderboardHandle: "arka" }
  })

  it("saves a valid handle", async () => {
    const res = await postHandle("Arka")
    const body = (await res.json()) as { leaderboardHandle?: string }

    expect(res.status).toBe(200)
    expect(body.leaderboardHandle).toBe("arka")
  })

  it("rejects a missing handle", async () => {
    const res = await postHandle(undefined)
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_handle")
  })

  it("surfaces a taken-handle error from the service", async () => {
    handleResult = { ok: false, error: "That handle is already taken — try another." }
    const res = await postHandle("taken")
    const body = (await res.json()) as { error?: string; code?: string }

    expect(res.status).toBe(400)
    expect(body.error).toBe("That handle is already taken — try another.")
    expect(body.code).toBe("invalid_handle")
  })
})

describe("POST /api/user/show-photo", () => {
  beforeEach(() => {
    currentUser = { id: "user_1" }
    showPhotoResult = { leaderboardShowPhoto: false }
  })

  it("updates the photo-visibility preference", async () => {
    const res = await postShowPhoto(false)
    const body = (await res.json()) as { leaderboardShowPhoto?: boolean }

    expect(res.status).toBe(200)
    expect(body.leaderboardShowPhoto).toBe(false)
  })

  it("rejects a non-boolean showPhoto", async () => {
    const res = await postShowPhoto("yes")
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_show_photo")
  })
})
