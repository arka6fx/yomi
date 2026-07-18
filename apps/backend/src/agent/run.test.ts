import { beforeEach, describe, expect, it, mock } from "bun:test"

let mockUser: Record<string, unknown> | null = null
let mockBotMessageCount = 0
let mockCreditBalance = 100
let lastInsertedKind: string | null = null
let consumeCreditsCalled = false
let lastUpdatedCreditsCharged: number | null = null
let lastAgentSystem: string | undefined
let mockExecuteRows: unknown[] = []
const activeTrialEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

const fakeDbWithCount = {
  select: () => ({
    from: () => ({
      where: () => {
        const p = Promise.resolve(mockUser ? [{ count: mockBotMessageCount }] : [{ count: 0 }])
        return {
          limit: () => (mockUser ? Promise.resolve([mockUser]) : Promise.resolve([])),
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
  update: () => ({
    set: (v: Record<string, unknown>) => {
      if ("creditsCharged" in v) lastUpdatedCreditsCharged = v["creditsCharged"] as number
      return { where: () => Promise.resolve() }
    },
  }),
  execute: () => Promise.resolve({ rows: mockExecuteRows }),
}

mock.module("@yomi/db", () => ({
  db: fakeDbWithCount,
  usageEvents: {},
  agentMessages: {},
  agentSessions: {},
  ragChunks: {},
  ragDocuments: {},
  ragSources: {},
  ragEmbeddings: {},
  ragRetrievalLogs: {},
  memoryEntries: {},
  memorySources: {},
  memoryRelations: {},
  memoryEmbeddings: {},
  privacyConsents: {},
  privacyPreferences: {},
  privacyAuditEvents: {},
  paymentRecords: {},
}))

mock.module("@yomi/agent-core", () => ({
  createModel: (model: string) => model,
  makeComposioLinearDef: () => ({ id: "linear", tools: () => ({}) }),
  makeComposioGitHubDef: () => ({ id: "github", tools: () => ({}) }),
  makeComposioSlackDef: () => ({ id: "slack", tools: () => ({}) }),
  makeComposioNotionDef: () => ({ id: "notion", tools: () => ({}) }),
  makeComposioGmailDef: () => ({ id: "google", tools: () => ({}) }),
  makeComposioCalendarDef: () => ({ id: "google-calendar", tools: () => ({}) }),
  makeComposioDriveDef: () => ({ id: "google-drive", tools: () => ({}) }),
  makeComposioClassroomDef: () => ({ id: "google-classroom", tools: () => ({}) }),
  makeComposioTasksDef: () => ({ id: "google-tasks", tools: () => ({}) }),
  makeComposioContactsDef: () => ({ id: "google-contacts", tools: () => ({}) }),
  makeComposioMeetDef: () => ({ id: "google-meet", tools: () => ({}) }),
  ConnectorRegistry: class {
    async init() {}
  },
  runAgentLoop: async (opts: {
    system?: string
    onUsage?: (usage: Record<string, unknown>) => void
  }) => {
    lastAgentSystem = opts.system
    opts.onUsage?.({
      model: "gpt-5.5",
      inputTokens: 100,
      outputTokens: 50,
      toolCallCount: 0,
      finishReason: "stop",
    })
    return "The answer is 42."
  },
}))

const recordedTelemetry: Array<Record<string, unknown>> = []
mock.module("../services/ai-telemetry.js", () => ({
  recordAiUsage: async (input: Record<string, unknown>) => {
    recordedTelemetry.push(input)
  },
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
  expireCredits: async () => 0,
  recentCreditTransactions: async () => [],
  grantCredits: async () => ({ ok: true }),
  refundCredits: async () => ({ ok: true }),
  createPaymentRecord: async () => ({ id: "pay_1" }),
}))

mock.module("../auth-schema.js", () => ({ user: {} }))

mock.module("../services/privacy/checks.js", () => ({
  checkConsent: async () => ({ allowed: true, reason: null }),
}))

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user_1",
    email: "test@example.com",
    role: "user",
    plan: "explore",
    subscriptionStatus: "active",
    currentPeriodEnd: null,
    trialEndDate: activeTrialEndDate,
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
    lastUpdatedCreditsCharged = null
    lastAgentSystem = undefined
    mockExecuteRows = []
    recordedTelemetry.length = 0
    delete process.env["YOMI_AGENT_SOUL"]
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

  it("blocks explore user out of credits (must subscribe)", async () => {
    mockUser = makeUser({ plan: "explore", subscriptionStatus: "active" })
    mockCreditBalance = 0
    const { runAgent } = await import("./run.js")
    const result = await runAgent({ userId: "user_1", text: "hi" })
    expect(result.quotaError).toBe(true)
    expect(result.text).toInclude("trial credits")
  })

  it("blocks subscribed user out of credits (buy a pack)", async () => {
    mockUser = makeUser({ plan: "pro", subscriptionStatus: "active" })
    mockCreditBalance = 0
    const { runAgent } = await import("./run.js")
    const result = await runAgent({ userId: "user_1", text: "hi" })
    expect(result.quotaError).toBe(true)
    expect(result.text).toInclude("credit pack")
  })

  it("allows explore user with credits if trial is active", async () => {
    mockUser = makeUser({ plan: "explore", subscriptionStatus: "active" })
    mockCreditBalance = 100
    const { runAgent } = await import("./run.js")
    const result = await runAgent({ userId: "user_1", text: "hi" })
    expect(result.quotaError).toBeUndefined()
    expect(result.text).toBe("The answer is 42.")
  })

  it("blocks explore user with expired trial", async () => {
    mockUser = makeUser({
      plan: "explore",
      subscriptionStatus: "active",
      trialEndDate: new Date(Date.now() - 1000),
    })
    const { runAgent } = await import("./run.js")
    const result = await runAgent({ userId: "user_1", text: "hi" })
    expect(result.quotaError).toBe(true)
    expect(result.text).toInclude("inactive")
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

  it("records ai telemetry for the agent turn", async () => {
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(recordedTelemetry.length).toBe(1)
    expect(recordedTelemetry[0]!["endpoint"]).toBe("backend.agent")
    expect(recordedTelemetry[0]!["surface"]).toBe("telegram")
  })

  it("writes creditsCharged back to the bot_message usage event so the meter reflects it", async () => {
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(lastUpdatedCreditsCharged).toBe(1)
  })

  it("passes the agent soul in the backend system prompt", async () => {
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(lastAgentSystem).toContain("<agent_soul>")
    expect(lastAgentSystem).toContain("You are Yomi: sharp, warm, and practical.")
  })

  it("supports a backend soul override", async () => {
    process.env["YOMI_AGENT_SOUL"] = "Be concise and precise."
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(lastAgentSystem).toContain("<agent_soul>\nBe concise and precise.\n</agent_soul>")
    expect(lastAgentSystem).not.toContain("You are Yomi: sharp, warm, and practical.")
  })

  it("injects static and dynamic memory profiles in the backend system prompt", async () => {
    mockExecuteRows = [
      { content: "Prefers TypeScript", summary: null, isStatic: true },
      { content: "Working on Yomi memory", summary: null, isStatic: false },
    ]
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "what do you remember?" })
    expect(lastAgentSystem).toContain("<static_profile>")
    expect(lastAgentSystem).toContain("Prefers TypeScript")
    expect(lastAgentSystem).toContain("<dynamic_profile>")
    expect(lastAgentSystem).toContain("Working on Yomi memory")
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
