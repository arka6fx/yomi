import { beforeEach, describe, expect, it, mock } from "bun:test"

// Metering seam test for Composio per-call charging. Mocks the DB + credit ledger
// (isolated per file under `bun test --isolate`) and drives the real chargeUsage,
// following the prior art in run.test.ts / suggestions metering tests.

let insertedKind: string | null = null
let insertedMetadata: Record<string, unknown> | null = null
let consumeAmount: number | null = null
let updatedCreditsCharged: number | null = null
let mockBalance = 1000

const fakeDb = {
  insert: () => ({
    values: (v: Record<string, unknown>) => {
      insertedKind = v["kind"] as string
      insertedMetadata = (v["metadata"] as Record<string, unknown>) ?? null
      return { returning: () => Promise.resolve([{ id: "evt_1" }]) }
    },
  }),
  update: () => ({
    set: (v: Record<string, unknown>) => {
      if ("creditsCharged" in v) updatedCreditsCharged = v["creditsCharged"] as number
      return { where: () => Promise.resolve() }
    },
  }),
}

mock.module("@yomi/db", () => ({ db: fakeDb, usageEvents: {} }))

mock.module("./credit-ledger.js", () => ({
  getCreditSummary: async () => ({ balance: mockBalance }),
  consumeCredits: async ({ amount }: { amount: number }) => {
    consumeAmount = amount
    return { ok: true, charged: amount, balance: mockBalance - amount }
  },
}))

const { chargeUsage } = await import("./metering.js")

const activeUser = {
  id: "user_1",
  email: "u@test.com",
  role: "user",
  plan: "pro",
  subscriptionStatus: "active",
  currentPeriodEnd: new Date(Date.now() + 86_400_000),
  trialEndDate: null,
}

beforeEach(() => {
  insertedKind = null
  insertedMetadata = null
  consumeAmount = null
  updatedCreditsCharged = null
  mockBalance = 1000
})

describe("chargeUsage — composio_tool metering", () => {
  it("charges one credit per Composio call and records a composio_tool event", async () => {
    const result = await chargeUsage({
      user: activeUser,
      kind: "composio_tool",
      units: 4,
      metadata: { composioCalls: 4 },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.creditsRequired).toBe(4)
      expect(result.creditsCharged).toBe(4)
    }
    expect(insertedKind).toBe("composio_tool")
    expect(consumeAmount).toBe(4)
    expect(updatedCreditsCharged).toBe(4)
    expect(insertedMetadata).toMatchObject({ reserveKind: "composio_tool", composioCalls: 4 })
  })

  it("scales the charge with the number of calls", async () => {
    const one = await chargeUsage({ user: activeUser, kind: "composio_tool", units: 1 })
    expect(one.ok && one.creditsRequired).toBe(1)

    const seven = await chargeUsage({ user: activeUser, kind: "composio_tool", units: 7 })
    expect(seven.ok && seven.creditsRequired).toBe(7)
  })

  it("blocks when the balance can't cover the Composio calls", async () => {
    mockBalance = 2
    const result = await chargeUsage({ user: activeUser, kind: "composio_tool", units: 5 })
    expect(result.ok).toBe(false)
    expect(consumeAmount).toBeNull()
  })
})
