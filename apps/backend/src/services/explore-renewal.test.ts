import { beforeEach, describe, expect, it, mock } from "bun:test"

const state = {
  // Pre-filtered as if the real lt(trialEndDate, now) + isNull(deletedAt) where
  // clause already ran — the mock db below doesn't evaluate drizzle conditions.
  users: [] as Array<{
    id: string
    email: string
    plan: string | null
    trialEndDate: Date | null
  }>,
  balances: [] as Array<{ userId: string; balance: number }>,
  userUpdates: [] as Array<Record<string, unknown>>,
  grants: [] as Array<{ userId: string; amount: number; expiresAt: Date | null }>,
}

mock.module("@yomi/db", () => ({
  creditAccounts: { userId: "user_id", availableCredits: "available_credits" },
  db: {
    // The service issues two selects: due users, then all credit account balances.
    select: (cols: Record<string, unknown>) => ({
      from: () => {
        const isAccounts = "balance" in (cols ?? {})
        const rows = isAccounts ? state.balances : state.users
        return {
          where: async () => rows,
          then: (res: (rows: unknown[]) => void) => res(rows),
        }
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          state.userUpdates.push(values)
        },
      }),
    }),
  },
}))

mock.module("../services/credit-ledger.js", () => ({
  grantCredits: async (input: { userId: string; amount: number; expiresAt: Date | null }) => {
    state.grants.push({ userId: input.userId, amount: input.amount, expiresAt: input.expiresAt })
    return { granted: true, balance: input.amount }
  },
  expireCredits: async () => 0,
}))

const { renewExploreCredits } = await import("./explore-renewal.js")

describe("renewExploreCredits", () => {
  beforeEach(() => {
    state.users = [
      // window ended, balance already at 0 — full top-up
      {
        id: "u_zero",
        email: "zero@example.com",
        plan: "explore",
        trialEndDate: new Date("2026-06-01T00:00:00Z"),
      },
      // window ended, still holds some unused credits — tops up only the gap
      {
        id: "u_partial",
        email: "partial@example.com",
        plan: "explore",
        trialEndDate: new Date("2026-06-01T00:00:00Z"),
      },
      // paid plan whose trialEndDate happens to be null/past — must be skipped
      {
        id: "u_pro",
        email: "pro@example.com",
        plan: "pro",
        trialEndDate: new Date("2020-01-01T00:00:00Z"),
      },
    ]
    state.balances = [
      { userId: "u_zero", balance: 0 },
      { userId: "u_partial", balance: 40 },
      { userId: "u_pro", balance: 300 },
    ]
    state.userUpdates = []
    state.grants = []
  })

  it("tops each due explore account up to the plan's included credits", async () => {
    const now = new Date("2026-07-01T00:00:00Z")
    const result = await renewExploreCredits(now)

    expect(result.renewed).toBe(2)
    expect(result.creditsGranted).toBe(160) // 100 for u_zero + 60 for u_partial
    expect(state.grants).toEqual([
      { userId: "u_zero", amount: 100, expiresAt: expect.any(Date) },
      { userId: "u_partial", amount: 60, expiresAt: expect.any(Date) },
    ])
  })

  it("restarts the 30-day window from now for every renewed account", async () => {
    const now = new Date("2026-07-01T00:00:00Z")
    await renewExploreCredits(now)

    const expectedEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).getTime()
    // Only the 2 due explore accounts get their window restarted (pro skipped).
    expect(state.userUpdates).toHaveLength(2)
    for (const update of state.userUpdates) {
      expect((update["trialEndDate"] as Date).getTime()).toBe(expectedEnd)
    }
  })

  it("skips paid plans even if their row comes back due", async () => {
    const now = new Date("2026-07-01T00:00:00Z")
    await renewExploreCredits(now)

    expect(state.grants.map((g) => g.userId)).not.toContain("u_pro")
    expect(state.userUpdates).toHaveLength(2)
  })

  it("does nothing when no accounts are due", async () => {
    state.users = []
    const result = await renewExploreCredits(new Date("2026-07-01T00:00:00Z"))
    expect(result).toEqual({ renewed: 0, creditsGranted: 0 })
    expect(state.grants).toEqual([])
  })
})
