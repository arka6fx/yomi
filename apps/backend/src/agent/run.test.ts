import { beforeEach, describe, expect, it, mock } from "bun:test"

let mockUser: Record<string, unknown> | null = null
let mockBotMessageCount = 0
let mockCreditBalance = 100
let lastInsertedKind: string | null = null
let consumeCreditsCalled = false

const fakeDbWithCount = {
  select: () => ({
    from: () => ({
      where: () => {
        const p = Promise.resolve(
          mockUser ? [{ count: mockBotMessageCount }] : [{ count: 0 }],
        )
        return {
          limit: () =>
            mockUser
              ? Promise.resolve([mockUser])
              : Promise.resolve([]),
          then: p.then.bind(p),
          catch: p.catch.bind(p),
        }
      },
    }),
  }),
  insert: () => ({
    values: (v: Record<string, unknown>) => {
      lastInsertedKind = v["kind"] as string
      return {
        returning: () => Promise.resolve([{ id: "evt_1" }]),
      }
    },
  }),
  execute: () => Promise.resolve({ rows: [] }),
}

mock.module("@yomi/db", () => ({
  db: fakeDbWithCount,
  usageEvents: {},
  ragChunks: {},
  ragDocuments: {},
  ragSources: {},
}))

mock.module("@yomi/agent-core", () => ({
  ConnectorRegistry: class {
    async init() {}
  },
  runAgentLoop: async () => "The answer is 42.",
}))

mock.module("../services/integration-tokens.js", () => ({
  getAccessToken: async () => "tok",
  listConnectedProviders: async () => [],
}))

mock.module("../services/credit-ledger.js", () => ({
  getCreditSummary: async () => ({
    balance: mockCreditBalance,
    lifetimeGranted: 0,
    lifetimeConsumed: 0,
    lifetimeRefunded: 0,
    expiringSoon: 0,
    expiringSoonAt: null,
  }),
  consumeCredits: async () => {
    consumeCreditsCalled = true
    return { ok: true, charged: 1, balance: mockCreditBalance - 1 }
  },
}))

mock.module("../auth-schema.js", () => ({ user: {} }))

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user_1",
    email: "test@example.com",
    role: "user",
    plan: "explore",
    subscriptionStatus: "active",
    currentPeriodEnd: null,
    ...overrides,
  }
}

describe("runAgent metering", () => {
  beforeEach(() => {
    mockUser = makeUser()
    mockBotMessageCount = 0
    mockCreditBalance = 100
    lastInsertedKind = null
    consumeCreditsCalled = false
  })

  it("returns error when user not found", async () => {
    mockUser = null
    const { runAgent } = await import("./run.js")
    const result = await runAgent({ userId: "ghost", text: "hi" })
    expect(result.text).toInclude("couldn't find")
  })

  it("blocks inactive subscription", async () => {
    mockUser = makeUser({ plan: "pro", subscriptionStatus: "inactive" })
    const { runAgent } = await import("./run.js")
    const result = await runAgent({ userId: "user_1", text: "hi" })
    expect(result.quotaError).toBe(true)
    expect(result.text).toInclude("inactive")
  })

  it("blocks when botMessages monthly limit is reached", async () => {
    mockUser = makeUser({ plan: "explore", subscriptionStatus: "active" })
    mockBotMessageCount = 20
    const { runAgent } = await import("./run.js")
    const result = await runAgent({ userId: "user_1", text: "hi" })
    expect(result.quotaError).toBe(true)
    expect(result.text).toInclude("bot messages")
  })

  it("blocks explore user with 0 credits", async () => {
    mockUser = makeUser({ plan: "explore", subscriptionStatus: "active" })
    mockCreditBalance = 0
    const { runAgent } = await import("./run.js")
    const result = await runAgent({ userId: "user_1", text: "hi" })
    expect(result.quotaError).toBe(true)
  })

  it("logs a bot_message event (not gateway_message)", async () => {
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(lastInsertedKind).toBe("bot_message")
  })

  it("calls consumeCredits after a successful run", async () => {
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(consumeCreditsCalled).toBe(true)
  })

  it("owner bypasses all quota and credit checks", async () => {
    mockUser = makeUser({ role: "owner", plan: "explore", subscriptionStatus: null })
    mockBotMessageCount = 9999
    mockCreditBalance = 0
    const { runAgent } = await import("./run.js")
    const result = await runAgent({ userId: "user_1", text: "hi" })
    expect(result.quotaError).toBeUndefined()
    expect(result.text).toBe("The answer is 42.")
    expect(consumeCreditsCalled).toBe(false)
  })
})
