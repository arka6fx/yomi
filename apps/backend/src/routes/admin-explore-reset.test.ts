import { beforeEach, describe, expect, it, mock } from "bun:test"
import { Hono } from "hono"

type TestUser = { id: string; email: string; role?: string | null; plan?: string | null }

let currentUser: TestUser

const state = {
  users: [] as Array<{
    id: string
    email: string
    role: string | null
    plan: string | null
    trialEndDate: Date | null
    deletedAt: Date | null
  }>,
  balances: [] as Array<{ userId: string; balance: number }>,
  grants: [] as Array<{ userId: string; amount: number; expiresAt: Date | null }>,
  userUpdates: [] as Array<Record<string, unknown>>,
  grantExpiryUpdates: 0,
}

mock.module("../auth.js", () => ({
  authenticate: async (c: any, next: any) => {
    c.set("user", currentUser)
    await next()
  },
}))

mock.module("@yomi/db", () => ({
  usageEvents: {},
  paymentRecords: {},
  creditAccounts: { userId: "user_id", availableCredits: "available_credits" },
  creditGrants: { userId: "user_id", status: "status", source: "source", expiresAt: "expires_at" },
  db: {
    // The route issues two selects: users, then credit accounts.
    select: (cols: any) => ({
      from: () => {
        const isAccounts = "balance" in (cols ?? {})
        const rows = isAccounts ? state.balances : state.users.filter((u) => !u.deletedAt)
        return {
          where: async () => rows,
          then: (res: any) => res(rows),
        }
      },
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        where: async () => {
          if (table?.status === "status") state.grantExpiryUpdates++
          else state.userUpdates.push(values)
        },
      }),
    }),
    delete: () => ({ where: async () => {} }),
  },
}))

mock.module("../services/credit-ledger.js", () => ({
  grantCredits: async (input: any) => {
    state.grants.push({ userId: input.userId, amount: input.amount, expiresAt: input.expiresAt })
    return { granted: true, balance: 100 }
  },
}))

const { adminRouter } = await import("./admin.js")

function app() {
  const a = new Hono()
  a.route("/api/admin", adminRouter)
  return a
}

function resetTrials(body: Record<string, unknown>) {
  return app().request("/api/admin/reset-explore-trials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("admin — reset explore trials", () => {
  beforeEach(() => {
    process.env["OWNER_EMAIL"] = "owner@example.com"
    currentUser = { id: "owner_1", email: "owner@example.com", role: "owner" }
    state.users = [
      // holds 100 from the old explore grant — must not be reduced
      { id: "u_rich", email: "rich@example.com", role: "user", plan: "explore", trialEndDate: new Date("2026-07-17T00:00:00Z"), deletedAt: null },
      // signup grant failed — must be topped up to 100
      { id: "u_zero", email: "zero@example.com", role: "user", plan: "explore", trialEndDate: new Date("2026-07-16T00:00:00Z"), deletedAt: null },
      // paying customer — must be skipped entirely
      { id: "u_pro", email: "pro@example.com", role: "user", plan: "pro", trialEndDate: null, deletedAt: null },
      // owner — must be skipped entirely
      { id: "owner_1", email: "owner@example.com", role: "owner", plan: "explore", trialEndDate: null, deletedAt: null },
    ]
    state.balances = [
      { userId: "u_rich", balance: 100 },
      { userId: "u_zero", balance: 0 },
      { userId: "u_pro", balance: 85 },
      { userId: "owner_1", balance: 8958 },
    ]
    state.grants = []
    state.userUpdates = []
    state.grantExpiryUpdates = 0
  })

  it("rejects non-owner callers", async () => {
    currentUser = { id: "u_rich", email: "rich@example.com", role: "user" }
    const res = await resetTrials({ dryRun: false })
    expect(res.status).toBe(403)
    expect(state.userUpdates).toHaveLength(0)
    expect(state.grants).toHaveLength(0)
  })

  it("defaults to a dry run that writes nothing", async () => {
    const body = (await (await resetTrials({})).json()) as any

    expect(body.dryRun).toBe(true)
    expect(body.usersAffected).toBe(2)
    expect(state.userUpdates).toHaveLength(0)
    expect(state.grants).toHaveLength(0)
    expect(state.grantExpiryUpdates).toBe(0)
  })

  it("tops up to 100 without ever reducing a larger balance", async () => {
    const body = (await (await resetTrials({ dryRun: false })).json()) as any

    expect(body.usersAffected).toBe(2)
    expect(body.users.map((u: any) => [u.email, u.balanceBefore, u.topUp, u.balanceAfter])).toEqual([
      ["rich@example.com", 100, 0, 100],
      ["zero@example.com", 0, 100, 100],
    ])
    // only the zero-balance account is granted anything
    expect(state.grants).toEqual([
      { userId: "u_zero", amount: 100, expiresAt: expect.any(Date) },
    ])
  })

  it("skips the owner and paid plans", async () => {
    const body = (await (await resetTrials({ dryRun: false })).json()) as any

    const emails = body.users.map((u: any) => u.email)
    expect(emails).not.toContain("owner@example.com")
    expect(emails).not.toContain("pro@example.com")
    expect(state.grants.map((g) => g.userId)).not.toContain("owner_1")
    expect(state.userUpdates).toHaveLength(2)
  })

  it("restarts the trial 30 days out and carries live grants forward", async () => {
    const before = Date.now()
    const body = (await (await resetTrials({ dryRun: false })).json()) as any

    const trialEnd = new Date(body.trialEndsAt).getTime()
    const expected = before + 30 * 24 * 60 * 60 * 1000
    expect(Math.abs(trialEnd - expected)).toBeLessThan(60_000)

    for (const update of state.userUpdates) {
      expect(new Date(update["trialEndDate"] as Date).getTime()).toBe(trialEnd)
    }
    // both explore accounts get their unexpired grants pushed to the new trial end
    expect(state.grantExpiryUpdates).toBe(2)
  })
})
