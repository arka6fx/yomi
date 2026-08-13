import { beforeEach, describe, expect, it, mock } from "bun:test"

let selectQueue: unknown[][] = []
let insertedValues: Record<string, unknown>[] = []
let insertResult: unknown[] | Error = []
let updateSets: Record<string, unknown>[] = []

function selectChain() {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(selectQueue.shift() ?? []),
  }
  return chain
}

const fakeDb = {
  select: () => selectChain(),
  insert: () => ({
    values: (row: Record<string, unknown>) => {
      insertedValues.push(row)
      return {
        returning: () => {
          if (insertResult instanceof Error) return Promise.reject(insertResult)
          return Promise.resolve(insertResult)
        },
      }
    },
  }),
  update: () => ({
    set: (values: Record<string, unknown>) => {
      updateSets.push(values)
      return { where: () => Promise.resolve() }
    },
  }),
}

mock.module("@yomi/db", () => ({ db: fakeDb, referralEvents: {} }))
mock.module("../auth-schema.js", () => ({ user: {} }))

let grantCreditsCalls: Record<string, unknown>[] = []
mock.module("./credit-ledger.js", () => ({
  grantCredits: async (input: Record<string, unknown>) => {
    grantCreditsCalls.push(input)
    return { granted: true, balance: 100 }
  },
}))

const { getOrCreateReferralCode, getReferralStats, redeemReferralCode } = await import(
  "./referrals.js"
)

beforeEach(() => {
  selectQueue = []
  insertedValues = []
  insertResult = []
  updateSets = []
  grantCreditsCalls = []
})

describe("getOrCreateReferralCode", () => {
  it("returns the existing code without generating a new one", async () => {
    selectQueue = [[{ referralCode: "abc12345" }]]
    const code = await getOrCreateReferralCode("user_1")
    expect(code).toBe("abc12345")
    expect(updateSets).toHaveLength(0)
  })

  it("generates and persists a new code when none exists", async () => {
    selectQueue = [[]]
    const code = await getOrCreateReferralCode("user_1")
    expect(code).toMatch(/^[0-9a-f]{8}$/)
    expect(updateSets).toHaveLength(1)
    expect(updateSets[0]?.referralCode).toBe(code)
  })
})

describe("getReferralStats", () => {
  it("returns code, count, cap, and summed credits from events", async () => {
    const createdAt1 = new Date("2026-08-01T00:00:00Z")
    const createdAt2 = new Date("2026-08-02T00:00:00Z")
    selectQueue = [
      [{ referralCode: "abc12345" }],
      [
        { id: "e1", creditsGranted: 100, createdAt: createdAt1 },
        { id: "e2", creditsGranted: 100, createdAt: createdAt2 },
      ],
    ]
    const stats = await getReferralStats("user_1")
    expect(stats).toEqual({
      code: "abc12345",
      count: 2,
      cap: 20,
      creditsEarned: 200,
      events: [
        { id: "e1", creditsGranted: 100, createdAt: createdAt1 },
        { id: "e2", creditsGranted: 100, createdAt: createdAt2 },
      ],
    })
  })
})

describe("redeemReferralCode", () => {
  const freshDate = new Date(Date.now() - 60_000) // 1 minute ago

  it("redeems successfully for a fresh, eligible account", async () => {
    selectQueue = [[{ id: "referrer_1" }], [{ count: 0 }]]
    insertResult = [{ id: "event_1" }]

    const result = await redeemReferralCode({
      code: "abc12345",
      referredUserId: "friend_1",
      referredUserCreatedAt: freshDate,
    })

    expect(result).toEqual({ redeemed: true })
    expect(insertedValues[0]).toEqual({
      referrerUserId: "referrer_1",
      referredUserId: "friend_1",
      creditsGranted: 100,
    })
    expect(grantCreditsCalls).toHaveLength(1)
    expect(grantCreditsCalls[0]).toMatchObject({
      userId: "referrer_1",
      amount: 100,
      source: "referral",
      sourceId: "referral:event_1",
      idempotencyKey: "referral:event_1:credit",
    })
  })

  it("rejects an account older than the 15-minute window", async () => {
    const oldDate = new Date(Date.now() - 20 * 60_000)
    const result = await redeemReferralCode({
      code: "abc12345",
      referredUserId: "friend_1",
      referredUserCreatedAt: oldDate,
    })
    expect(result).toEqual({ redeemed: false, reason: "not_new_account" })
    expect(insertedValues).toHaveLength(0)
    expect(grantCreditsCalls).toHaveLength(0)
  })

  it("rejects an invalid/unknown code", async () => {
    selectQueue = [[]]
    const result = await redeemReferralCode({
      code: "nope",
      referredUserId: "friend_1",
      referredUserCreatedAt: freshDate,
    })
    expect(result).toEqual({ redeemed: false, reason: "invalid_code" })
  })

  it("rejects self-referral", async () => {
    selectQueue = [[{ id: "user_1" }]]
    const result = await redeemReferralCode({
      code: "abc12345",
      referredUserId: "user_1",
      referredUserCreatedAt: freshDate,
    })
    expect(result).toEqual({ redeemed: false, reason: "self_referral" })
  })

  it("rejects once the referrer has reached the cap", async () => {
    selectQueue = [[{ id: "referrer_1" }], [{ count: 20 }]]
    const result = await redeemReferralCode({
      code: "abc12345",
      referredUserId: "friend_1",
      referredUserCreatedAt: freshDate,
    })
    expect(result).toEqual({ redeemed: false, reason: "cap_reached" })
    expect(insertedValues).toHaveLength(0)
  })

  it("rejects a duplicate redemption for the same referred user", async () => {
    selectQueue = [[{ id: "referrer_1" }], [{ count: 0 }]]
    insertResult = new Error(
      'duplicate key value violates unique constraint "referral_events_referred_user_id_unique"',
    )
    const result = await redeemReferralCode({
      code: "abc12345",
      referredUserId: "friend_1",
      referredUserCreatedAt: freshDate,
    })
    expect(result).toEqual({ redeemed: false, reason: "already_redeemed" })
    expect(grantCreditsCalls).toHaveLength(0)
  })
})
