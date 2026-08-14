import { beforeEach, describe, expect, it, mock } from "bun:test"

const state = {
  // Pre-filtered as if the real where clause (deletedAt null, dodoSubscriptionId
  // null, subscriptionStatus active, currentPeriodEnd null-or-past) already ran —
  // the mock db below doesn't evaluate drizzle conditions.
  users: [] as Array<{ id: string; plan: string }>,
  balances: [] as Array<{ userId: string; balance: number }>,
  userUpdates: [] as Array<Record<string, unknown>>,
  grants: [] as Array<{ userId: string; amount: number; expiresAt: Date | null; metadata: unknown }>,
}

mock.module("@yomi/db", () => ({
  creditAccounts: { userId: "user_id", availableCredits: "available_credits" },
  db: {
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

mock.module("./credit-ledger.js", () => ({
  grantCredits: async (input: {
    userId: string
    amount: number
    expiresAt: Date | null
    metadata: unknown
  }) => {
    state.grants.push({
      userId: input.userId,
      amount: input.amount,
      expiresAt: input.expiresAt,
      metadata: input.metadata,
    })
    return { granted: true, balance: input.amount }
  },
}))

const { renewNonBilledPaidCredits } = await import("./plan-renewal.js")

describe("renewNonBilledPaidCredits", () => {
  beforeEach(() => {
    state.users = [
      // due, empty balance — full top-up to max's 750
      { id: "u_max_empty", plan: "max" },
      // due, partial balance — tops up only the gap
      { id: "u_pro_partial", plan: "pro" },
      // due per the where clause, but explore — must be skipped (not a paid plan)
      { id: "u_explore", plan: "explore" },
    ]
    state.balances = [
      { userId: "u_max_empty", balance: 0 },
      { userId: "u_pro_partial", balance: 100 },
      { userId: "u_explore", balance: 0 },
    ]
    state.userUpdates = []
    state.grants = []
  })

  it("tops each due non-billed paid account up to its plan's included credits", async () => {
    const now = new Date("2026-09-13T00:00:00Z")
    const result = await renewNonBilledPaidCredits(now)

    expect(result.renewed).toBe(2)
    expect(result.creditsGranted).toBe(950) // 750 for max + 200 for pro (300-100)
    expect(state.grants).toEqual([
      {
        userId: "u_max_empty",
        amount: 750,
        expiresAt: expect.any(Date),
        metadata: { plan: "max", nonBilled: true },
      },
      {
        userId: "u_pro_partial",
        amount: 200,
        expiresAt: expect.any(Date),
        metadata: { plan: "pro", nonBilled: true },
      },
    ])
  })

  it("pushes currentPeriodEnd 30 days out for every renewed account", async () => {
    const now = new Date("2026-09-13T00:00:00Z")
    await renewNonBilledPaidCredits(now)

    const expectedEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).getTime()
    // Only the 2 due paid accounts get their period pushed (explore skipped).
    expect(state.userUpdates).toHaveLength(2)
    for (const update of state.userUpdates) {
      expect((update["currentPeriodEnd"] as Date).getTime()).toBe(expectedEnd)
    }
  })

  it("skips explore accounts even if their row comes back due", async () => {
    const now = new Date("2026-09-13T00:00:00Z")
    await renewNonBilledPaidCredits(now)

    expect(state.grants.map((g) => g.userId)).not.toContain("u_explore")
    expect(state.userUpdates).toHaveLength(2)
  })

  it("does nothing when no accounts are due", async () => {
    state.users = []
    const result = await renewNonBilledPaidCredits(new Date("2026-09-13T00:00:00Z"))
    expect(result).toEqual({ renewed: 0, creditsGranted: 0 })
    expect(state.grants).toEqual([])
  })
})
