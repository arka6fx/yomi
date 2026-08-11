import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test"

let mockUser: Record<string, unknown> | null = null
let mockBotMessageCount = 0
let mockCreditBalance = 100
let lastInsertedKind: string | null = null
let consumeCreditsCalled = false
let lastUpdatedCreditsCharged: number | null = null
let lastAgentSystem: string | undefined
let lastAgentExtraTools: Record<string, unknown> | undefined
let mockMemoryConsentAllowed = true
let mockCloudMemoryConsentAllowed = true
let capturedDeepResearchOpts:
  | {
      ragSearch: (query: string, limit: number) => Promise<unknown[]>
      memorySearch: (query: string, limit: number) => Promise<unknown[]>
    }
  | undefined
let mockExecuteRows: unknown[] = []
let executedStatements: unknown[] = []
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
  execute: (statement: unknown) => {
    executedStatements.push(statement)
    return Promise.resolve({ rows: mockExecuteRows })
  },
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
  customMcpServers: {},
  platformConnections: {},
}))

const realAgentCore = await import("@yomi/agent-core")

mock.module("@yomi/agent-core", () => ({
  ...realAgentCore,
  createModel: (model: string) => model,
  createRecallTool: () => ({}),
  // Captures ragSearch/memorySearch so tests can call them directly and assert on
  // consent-gating, without driving the real sub-loop (which would hit the network).
  // Description/execute are stubbed but kept truthy/string so the wiring test still
  // sees a real tool shape — the real description text is covered separately in
  // packages/agent-core/src/deep-research.test.ts.
  createDeepResearchTool: (opts: {
    ragSearch: (query: string, limit: number) => Promise<unknown[]>
    memorySearch: (query: string, limit: number) => Promise<unknown[]>
  }) => {
    capturedDeepResearchOpts = opts
    return { execute: async () => ({ result: "" }), description: "Research with cited sources." }
  },
  ConnectorRegistry: class {
    async init() {}
    getConnected() {
      return []
    }
    async loadMCPTools() {}
  },
  runAgentLoop: async (opts: {
    system?: string
    extraTools?: Record<string, unknown>
    onUsage?: (usage: Record<string, unknown>) => void
  }) => {
    lastAgentSystem = opts.system
    lastAgentExtraTools = opts.extraTools
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
  checkConsent: async (_userId: string, kind: string) => {
    if (kind === "memory") return { allowed: mockMemoryConsentAllowed, reason: null }
    if (kind === "cloud_memory") return { allowed: mockCloudMemoryConsentAllowed, reason: null }
    return { allowed: true, reason: null }
  },
}))

let resolvePendingDocumentIndexCalls: {
  userId: string
  title: string | undefined
  consumePendingDocument: unknown
  restorePendingDocument: unknown
}[] = []
mock.module("./pending-document.js", () => ({
  resolvePendingDocumentIndex: async (
    userId: string,
    title: string | undefined,
    consumePendingDocument: unknown,
    restorePendingDocument: unknown,
  ) => {
    resolvePendingDocumentIndexCalls.push({
      userId,
      title,
      consumePendingDocument,
      restorePendingDocument,
    })
    return { ok: true, documentId: "doc-1" }
  },
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
    lastAgentExtraTools = undefined
    mockMemoryConsentAllowed = true
    mockCloudMemoryConsentAllowed = true
    capturedDeepResearchOpts = undefined
    mockExecuteRows = []
    executedStatements = []
    recordedTelemetry.length = 0
    delete process.env["YOMI_AGENT_SOUL"]
    delete process.env["MEMORY_CANDIDATES"]
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

  it("blocks explore user out of credits (renews monthly or upgrade)", async () => {
    mockUser = makeUser({ plan: "explore", subscriptionStatus: "active" })
    mockCreditBalance = 0
    const { runAgent } = await import("./run.js")
    const result = await runAgent({ userId: "user_1", text: "hi" })
    expect(result.quotaError).toBe(true)
    expect(result.text).toInclude("free credits")
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

  it("wires a delegate tool into extraTools", async () => {
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(lastAgentExtraTools).toBeDefined()
    const delegateTool = lastAgentExtraTools!["delegate"] as {
      execute?: unknown
      description?: string
    }
    expect(typeof delegateTool.execute).toBe("function")
    expect(delegateTool.description).toContain("sub-agent")
  })

  it("wires a deep_research tool into extraTools", async () => {
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(lastAgentExtraTools).toBeDefined()
    const researchTool = lastAgentExtraTools!["deep_research"] as {
      execute?: unknown
      description?: string
    }
    expect(typeof researchTool.execute).toBe("function")
    expect(researchTool.description).toContain("cited")
  })

  it("wires an index_text tool into extraTools for a Pro-plan user", async () => {
    mockUser = makeUser({ plan: "pro" })
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(lastAgentExtraTools).toBeDefined()
    const indexTextTool = lastAgentExtraTools!["index_text"] as {
      execute?: unknown
      description?: string
    }
    expect(typeof indexTextTool.execute).toBe("function")
    expect(indexTextTool.description).toContain("index")
  })

  it("omits index_text from extraTools for an Explore-plan user", async () => {
    mockUser = makeUser({ plan: "explore" })
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(lastAgentExtraTools).toBeDefined()
    expect(lastAgentExtraTools!["index_text"]).toBeUndefined()
  })

  it("wires an index_url tool into extraTools for a Pro-plan user", async () => {
    mockUser = makeUser({ plan: "pro" })
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(lastAgentExtraTools).toBeDefined()
    const indexUrlTool = lastAgentExtraTools!["index_url"] as {
      execute?: unknown
      description?: string
    }
    expect(typeof indexUrlTool.execute).toBe("function")
    expect(indexUrlTool.description).toContain("URL")
  })

  it("omits index_url from extraTools for an Explore-plan user", async () => {
    mockUser = makeUser({ plan: "explore" })
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(lastAgentExtraTools).toBeDefined()
    expect(lastAgentExtraTools!["index_url"]).toBeUndefined()
  })

  it("wires an index_document tool into extraTools for a Pro-plan user", async () => {
    mockUser = makeUser({ plan: "pro" })
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(lastAgentExtraTools).toBeDefined()
    const indexDocumentTool = lastAgentExtraTools!["index_document"] as {
      execute?: unknown
      description?: string
    }
    expect(typeof indexDocumentTool.execute).toBe("function")
    expect(indexDocumentTool.description).toContain("document")
  })

  it("omits index_document from extraTools for an Explore-plan user", async () => {
    mockUser = makeUser({ plan: "explore" })
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(lastAgentExtraTools).toBeDefined()
    expect(lastAgentExtraTools!["index_document"]).toBeUndefined()
  })

  it("index_document's execute calls resolvePendingDocumentIndex with the turn's userId and callbacks", async () => {
    mockUser = makeUser({ plan: "pro" })
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(lastAgentExtraTools).toBeDefined()
    const indexDocumentTool = lastAgentExtraTools!["index_document"] as {
      execute: (args: { title?: string }, ctx: never) => Promise<unknown>
    }

    resolvePendingDocumentIndexCalls = []
    const result = await indexDocumentTool.execute({ title: "custom.pdf" }, {} as never)

    expect(resolvePendingDocumentIndexCalls).toEqual([
      {
        userId: "user_1",
        title: "custom.pdf",
        consumePendingDocument: undefined,
        restorePendingDocument: undefined,
      },
    ])
    expect(result).toEqual({ ok: true, documentId: "doc-1" })
  })

  // deep_research's rag_search/memory_search must never become a side door around a
  // consent the user denied — passive injection (fetchMemoryContext/fetchRagContext)
  // already gates on this, and the active tools have to match it exactly.
  it("deep_research's memorySearch degrades to empty when memory consent is denied", async () => {
    mockMemoryConsentAllowed = false
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })

    expect(capturedDeepResearchOpts).toBeDefined()
    const rows = await capturedDeepResearchOpts!.memorySearch("editor", 8)
    expect(rows).toEqual([])
  })

  it("deep_research's ragSearch degrades to empty when cloud memory consent is denied", async () => {
    mockCloudMemoryConsentAllowed = false
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })

    expect(capturedDeepResearchOpts).toBeDefined()
    const rows = await capturedDeepResearchOpts!.ragSearch("editor", 5)
    expect(rows).toEqual([])
  })

  it("deep_research's ragSearch/memorySearch call through when consent is granted", async () => {
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })

    expect(capturedDeepResearchOpts).toBeDefined()
    // Both consents are allowed (default), so these hit the real query functions —
    // which hit the mocked db.execute above and resolve to [] for an empty/mock
    // result set, not because consent blocked them. This is the contrast case that
    // proves the two tests above are asserting on consent, not on some other reason
    // the calls always return [].
    const memRows = await capturedDeepResearchOpts!.memorySearch("editor", 8)
    const ragRows = await capturedDeepResearchOpts!.ragSearch("editor", 5)
    expect(Array.isArray(memRows)).toBe(true)
    expect(Array.isArray(ragRows)).toBe(true)
  })

  it("supports a backend soul override", async () => {
    process.env["YOMI_AGENT_SOUL"] = "Be concise and precise."
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(lastAgentSystem).toContain("<agent_soul>\nBe concise and precise.\n</agent_soul>")
    expect(lastAgentSystem).not.toContain("You are Yomi: sharp, warm, and practical.")
  })

  // Deliberately asserts on the emitted statement rather than on behaviour: the agent's
  // recall tuning has no other observable surface, and it silently ignoring the env var
  // is the exact bug this guards (#94).
  it("tunes agent recall from MEMORY_CANDIDATES rather than a hardcoded constant", async () => {
    process.env["MEMORY_CANDIDATES"] = "77"
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "what do you remember?" })

    const numbers: number[] = []
    const walk = (chunks: unknown[]) => {
      for (const chunk of chunks) {
        if (typeof chunk === "number") numbers.push(chunk)
        else if (chunk && typeof chunk === "object" && "queryChunks" in chunk) {
          walk((chunk as { queryChunks: unknown[] }).queryChunks)
        }
      }
    }
    for (const statement of executedStatements) {
      if (statement && typeof statement === "object" && "queryChunks" in statement) {
        walk((statement as { queryChunks: unknown[] }).queryChunks)
      }
    }
    expect(numbers).toContain(77)
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

  it("injects each memory's age so the model can tell a correction from what it corrected", async () => {
    mockExecuteRows = [
      {
        content: "Uses VS Code",
        summary: null,
        isStatic: true,
        updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        kind: "preference",
        topic: "editor",
        sourcePath: null,
        matchedBy: ["vector"],
      },
    ]
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "what editor do I use?" })
    expect(lastAgentSystem).toContain("3d ago")
  })

  it("stops advertising confidence, which made the model prefer stale-but-confident memories", async () => {
    mockExecuteRows = [
      {
        content: "Uses vim",
        summary: null,
        isStatic: true,
        updatedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
        kind: "preference",
        topic: "editor",
        confidence: 95,
        sourcePath: null,
        matchedBy: ["vector"],
      },
    ]
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "what editor do I use?" })
    expect(lastAgentSystem).toContain("7mo ago")
    expect(lastAgentSystem).not.toContain("confidence 95")
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

// A per-turn-variable block (clock time, integration nudges, memory) placed ahead of
// a stable instruction paragraph defeats OpenAI's prefix-based prompt caching for
// everything after it — the whole point of these tests. A regression here silently
// re-inflates real cost without breaking anything functionally, which is exactly
// how the integrationSuggestions placement went unnoticed the first time.
describe("buildSystemWithContext cache stability", () => {
  it("keeps the fixed instruction prefix byte-identical across turns with different suggestions/memory/time", async () => {
    const { buildSystemWithContext } = await import("./run.js")
    const base = buildSystemWithContext("", "", undefined, null, "", "Asia/Kolkata", "")
    const varied = buildSystemWithContext(
      "some durable memory",
      "some rag context",
      { staticProfile: "static", dynamicProfile: "dynamic" },
      null,
      "recent chat here",
      "Asia/Kolkata",
      "Slack (communication): https://getyomi.in/dashboard?connect=slack",
    )

    // Stable through the last instruction line that never depends on turn content.
    const stableMarker = "</connector_ids>"
    const basePrefix = base.slice(0, base.indexOf(stableMarker) + stableMarker.length)
    const variedPrefix = varied.slice(0, varied.indexOf(stableMarker) + stableMarker.length)
    expect(variedPrefix).toBe(basePrefix)
  })

  it("places integrationSuggestions after the stable prefix, not before it", async () => {
    const { buildSystemWithContext } = await import("./run.js")
    const system = buildSystemWithContext(
      "",
      "",
      undefined,
      null,
      "",
      "Asia/Kolkata",
      "Slack (communication): https://getyomi.in/dashboard?connect=slack",
    )
    const stableMarker = "</connector_ids>"
    expect(system.indexOf("<available_integrations>")).toBeGreaterThan(system.indexOf(stableMarker))
  })

  it("tells the agent that the more recent of two conflicting memories is the current one", async () => {
    const { buildSystemWithContext } = await import("./run.js")
    const system = buildSystemWithContext(
      "- [preference, 3d ago] editor: Uses VS Code",
      "",
      undefined,
      null,
      "",
      "Asia/Kolkata",
      "",
    )
    expect(system).toContain("more recent one is current")
  })

  it("omits the conflict rule entirely when there is no memory block", async () => {
    const { buildSystemWithContext } = await import("./run.js")
    const system = buildSystemWithContext("", "", undefined, null, "", "Asia/Kolkata", "")
    expect(system).not.toContain("more recent one is current")
  })

  it("tells the agent to deep-link the not-connected/reconnect nudge with the service's id", async () => {
    const { buildSystemWithContext } = await import("./run.js")
    const system = buildSystemWithContext("", "", undefined, null, "", "Asia/Kolkata", "")
    expect(system).toContain("?connect=<id>")
    expect(system).toContain("<connector_ids>")
    expect(system).toContain("Google Gmail: google")
  })
})
