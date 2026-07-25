import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { GatewayMessage, PlatformType } from "@yomi/shared"
import type { AgentMessage } from "@yomi/agent-core"
import type { PlatformAdapter } from "./platform-adapter.js"

let agentCalls: {
  userId: string
  text: string
  history?: AgentMessage[]
  signal?: AbortSignal
  skipCharge?: boolean
}[] = []
let agentHangs = false
let loadedHistory: AgentMessage[] = []
let appendedTurns: {
  sessionId: string
  userId: string
  userText: string
  assistantText: string
}[] = []
let closedSessions: { userId: string; platform: string; chatId: string }[] = []
let pendingActions: { id: string; title: string; preview: string }[] = []
let approvedActions: string[] = []
let deniedActions: string[] = []
let soulCalls: { userId: string; text: string }[] = []
// null = onboarding complete, proceed to the agent (default for most tests).
let soulOnboardingReply: string | null = null
// "empty-length" simulates a reasoning model that spent its whole token budget on
// hidden reasoning and returned no visible text — see gateway-runner.ts's analyzeImage().
// "action" simulates the vision classifier deciding the caption is a task, not a question.
let imageAnalysisMode: "normal" | "empty-length" | "action" = "normal"
// null = asset storage not configured (default for most tests).
let uploadedAsset: { key: string; url: string; contentType: string } | null = null
let capturedUploadContentType: string | null = null

const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => ({
          then: (resolve: (rows: { id: string; userId: string; role: string }[]) => unknown) =>
            // role: "owner" makes isOwnerUser()/hasBillablePlanAccess() short-circuit true for
            // featureQuotaBlock's user lookup — no test here exercises billing gate logic.
            Promise.resolve(resolve([{ id: "conn_1", userId: "user_1", role: "owner" }])),
        }),
      }),
    }),
  }),
  insert: () => ({
    values: () => {
      // Mimic drizzle's chainable insert builder: awaitable directly, and also
      // supports .returning()/.onConflictDoUpdate() for callers that chain further.
      const chain = Promise.resolve(undefined) as Promise<undefined> & {
        returning: () => Promise<{ id: string }[]>
        onConflictDoUpdate: () => Promise<undefined>
      }
      chain.returning = () => Promise.resolve([{ id: "evt_1" }])
      chain.onConflictDoUpdate = () => Promise.resolve(undefined)
      return chain
    },
  }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  delete: () => ({ where: () => Promise.resolve() }),
}

mock.module("@yomi/db", () => ({
  db: fakeDb,
  creditAccounts: {},
  creditGrants: {},
  creditTransactions: {},
  paymentRecords: {},
  platformConnections: {
    id: "id",
    userId: "userId",
    platform: "platform",
    platformUserId: "platformUserId",
    platformChatId: "platformChatId",
  },
  linkingCodes: {},
  telegramLinkTokens: {},
  usageEvents: { id: "id" },
  privacyPreferences: {},
  privacyConsents: {},
}))

mock.module("../services/privacy/checks.js", () => ({
  checkConsent: async () => ({ allowed: true, reason: null }),
}))

mock.module("../agent/run.js", () => ({
  runAgent: async ({
    userId,
    text,
    history,
    signal,
    skipCharge,
  }: {
    userId: string
    text: string
    history?: AgentMessage[]
    signal?: AbortSignal
    skipCharge?: boolean
  }) => {
    agentCalls.push({ userId, text, history, signal, skipCharge })
    if (agentHangs) {
      // Mimic the real runAgent: when the abort signal fires it stops and
      // returns (it does not throw), yielding no usable text.
      await new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve()
        signal?.addEventListener("abort", () => resolve())
      })
      return { text: "" }
    }
    return { text: "backend reply" }
  },
}))

mock.module("../services/agent-sessions.js", () => ({
  getOrCreateAgentSession: async () => ({ id: "session_1", messageCount: 0 }),
  loadAgentHistory: async () => loadedHistory,
  appendAgentTurn: async (input: {
    sessionId: string
    userId: string
    userText: string
    assistantText: string
  }) => {
    appendedTurns.push(input)
  },
  closeAgentSession: async (input: { userId: string; platform: string; chatId: string }) => {
    closedSessions.push(input)
  },
}))

mock.module("../services/pending-actions.js", () => ({
  listPendingActions: async () => pendingActions,
  approvePendingAction: async (_userId: string, id: string) => {
    approvedActions.push(id)
    return { id, status: "executed", result: { ok: true }, title: "Test action" }
  },
  denyPendingAction: async (_userId: string, id: string) => {
    deniedActions.push(id)
    return { id, status: "denied" }
  },
  formatActionResult: (_result: unknown, fallback: string) => fallback,
}))

mock.module("../services/transcription.js", () => ({
  transcribeAudioUrl: async () => "",
}))

mock.module("../services/soul.js", () => ({
  advanceSoulOnboarding: async (userId: string, text: string) => {
    soulCalls.push({ userId, text })
    return soulOnboardingReply
  },
}))

const recordedTelemetry: Record<string, unknown>[] = []
mock.module("../services/ai-telemetry.js", () => ({
  recordAiUsage: async (input: Record<string, unknown>) => {
    recordedTelemetry.push(input)
  },
}))

// gateway-runner.ts's only runtime import from @yomi/agent-core is createModel
// (AgentMessage is type-only); no other file in this test's import graph reaches
// the real package, so it's safe to replace wholesale. The real generateText()
// (from "ai", left un-mocked) calls this fake model's doGenerate, so it completes
// without touching the network. Image messages (content is an array with an
// "image" part) get a canned vision reply + usage; anything else mimics
// NEED_AGENT so the existing fast-path-falls-through-to-agent tests still work.
mock.module("@yomi/agent-core", () => ({
  createModel: () => ({
    specificationVersion: "v1",
    provider: "openai",
    modelId: "test-model",
    defaultObjectGenerationMode: "json",
    async doGenerate(options: { prompt: Array<{ content: unknown }> }) {
      const last = options.prompt[options.prompt.length - 1]
      const isImage =
        Array.isArray(last?.content) &&
        (last.content as Array<{ type?: string }>).some((c) => c.type === "image")
      if (isImage && imageAnalysisMode === "empty-length") {
        return {
          text: "",
          finishReason: "length",
          usage: { promptTokens: 120, completionTokens: 600 },
          rawCall: { rawPrompt: options.prompt, rawSettings: {} },
        }
      }
      if (isImage && imageAnalysisMode === "action") {
        return {
          text: "ACTION\nA blue cat mascot logo on a gradient background.",
          finishReason: "stop",
          usage: { promptTokens: 120, completionTokens: 40 },
          rawCall: { rawPrompt: options.prompt, rawSettings: {} },
        }
      }
      return {
        text: isImage ? "It looks like a cat." : "NEED_AGENT",
        finishReason: "stop",
        usage: isImage
          ? { promptTokens: 120, completionTokens: 40 }
          : { promptTokens: 10, completionTokens: 2 },
        rawCall: { rawPrompt: options.prompt, rawSettings: {} },
      }
    },
  }),
}))

mock.module("../services/asset-storage.js", () => ({
  uploadAsset: async (_userId: string, _bytes: ArrayBuffer, contentType: string) => {
    capturedUploadContentType = contentType
    return uploadedAsset
  },
  assetStorageConfigured: () => uploadedAsset !== null,
}))

mock.module("../services/credit-ledger.js", () => ({
  consumeCredits: async () => ({ ok: true, charged: 1, balance: 99 }),
  createPaymentRecord: async () => "payment_1",
  getCreditSummary: async () => ({
    balance: 0,
    lifetimeGranted: 0,
    lifetimeConsumed: 0,
    lifetimeRefunded: 0,
    expiringSoon: 0,
    expiringSoonAt: null,
  }),
  grantCredits: async () => ({ granted: true, balance: 100 }),
  recentCreditTransactions: async () => [],
  expireUserCredits: async () => 0,
}))

const { GatewayRunner } = await import("./gateway-runner.js")

class FakeAdapter implements PlatformAdapter {
  readonly platform: PlatformType = "telegram"
  messages: { chatId: string; text: string }[] = []
  handler: ((msg: GatewayMessage) => void | Promise<void>) | null = null
  async connect() {}
  async disconnect() {}
  setMessageHandler(handler: (msg: GatewayMessage) => void | Promise<void>): void {
    this.handler = handler
  }
  async sendMessage(chatId: string, text: string) {
    this.messages.push({ chatId, text })
    return { ok: true }
  }
  async sendDocument() {
    return { ok: true }
  }
  async deleteMessage() {
    return { ok: true }
  }
  async sendTyping() {}
}

function incoming(runner: GatewayRunner, msg: GatewayMessage) {
  return (runner as unknown as { onIncoming: (msg: GatewayMessage) => Promise<void> }).onIncoming(
    msg,
  )
}

const originalFetch = globalThis.fetch

beforeEach(() => {
  agentCalls = []
  agentHangs = false
  delete process.env.YOMI_AGENT_RUN_TIMEOUT_MS
  loadedHistory = []
  appendedTurns = []
  closedSessions = []
  pendingActions = []
  approvedActions = []
  deniedActions = []
  soulCalls = []
  soulOnboardingReply = null
  imageAnalysisMode = "normal"
  uploadedAsset = null
  capturedUploadContentType = null
  recordedTelemetry.length = 0
  globalThis.fetch = (async () => {
    throw new Error("fetch should not run")
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("GatewayRunner production routing", () => {
  it("runs backend agent for normal Telegram messages", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "search my notion notes",
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls).toEqual([
      {
        userId: "user_1",
        text: "search my notion notes",
        history: [],
        signal: agentCalls[0]?.signal,
      },
    ])
    expect(adapter.messages.at(-1)?.text).toBe("backend reply")
    expect(appendedTurns).toEqual([
      {
        sessionId: "session_1",
        userId: "user_1",
        userText: "search my notion notes",
        assistantText: "backend reply",
      },
    ])
  })

  it("surfaces a shared location as agent context text", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "",
      location: { latitude: 12.9716, longitude: 77.5946 },
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls[0]?.text).toBe("📍 _Location:_ 12.9716, 77.5946")
  })

  it("intercepts a first-contact message with the personality ask and skips the agent", async () => {
    soulOnboardingReply = "Hey, I'm Yomi. Define my personality?"
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "hi",
      timestamp: new Date().toISOString(),
    })

    expect(soulCalls).toEqual([{ userId: "user_1", text: "hi" }])
    // Onboarding short-circuits: the ask is sent and the agent never runs (no charge).
    expect(adapter.messages.at(-1)?.text).toBe("Hey, I'm Yomi. Define my personality?")
    expect(agentCalls).toEqual([])
  })

  it("handles actions with the backend agent instead of queueing", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "take a screenshot",
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls).toEqual([
      { userId: "user_1", text: "take a screenshot", history: [], signal: agentCalls[0]?.signal },
    ])
    await expect(runner.getPendingMessages("user_1")).resolves.toHaveLength(0)
    expect(adapter.messages.at(-1)?.text).toBe("backend reply")
  })

  it("aborts a hung agent run after the timeout and tells the user", async () => {
    process.env.YOMI_AGENT_RUN_TIMEOUT_MS = "30"
    agentHangs = true
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "do something very slow",
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls[0]?.signal?.aborted).toBe(true)
    expect(adapter.messages.at(-1)?.text).toMatch(/too long/i)
  })

  it("loads persisted session history for backend agent context", async () => {
    loadedHistory = [
      { role: "user", content: "previous question" },
      { role: "assistant", content: "previous answer" },
    ]
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "continue",
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls[0]?.history).toEqual(loadedHistory)
  })

  it("closes the active persisted session for /new", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "/new",
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls).toHaveLength(0)
    expect(closedSessions).toEqual([
      { userId: "user_1", platform: "telegram", chatId: "chat_1" },
      { userId: "user_1", platform: "yomi", chatId: "global" },
    ])
    expect(adapter.messages.at(-1)?.text).toBe("Started a new conversation. How can I help you?")
  })

  it("approves the most recent pending action with /approve", async () => {
    pendingActions = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        title: "Send email",
        preview: "To: a@example.com",
      },
      { id: "22222222-2222-2222-2222-222222222222", title: "Create event", preview: "Tomorrow" },
    ]
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "/approve",
      timestamp: new Date().toISOString(),
    })

    expect(approvedActions).toEqual(["11111111-1111-1111-1111-111111111111"])
    expect(adapter.messages.some((m) => m.text?.includes("Approved"))).toBe(true)
    // The write is one step of a plan; the loop must be re-entered to finish it.
    expect(agentCalls).toHaveLength(1)
    expect(agentCalls[0]?.skipCharge).toBe(true)
  })

  it("approves the only pending action with /approve", async () => {
    pendingActions = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        title: "Send email",
        preview: "To: a@example.com",
      },
    ]
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "/approve",
      timestamp: new Date().toISOString(),
    })

    expect(approvedActions).toEqual(["11111111-1111-1111-1111-111111111111"])
    expect(
      adapter.messages.some((m) => m.text === "Approved and executed.\nDone: Test action"),
    ).toBe(true)
  })

  it("resumes the agent after an approved write so the rest of the plan runs", async () => {
    // "Solve this and give me the PDF" created the doc, the write was approved, and
    // the turn ended there — the conversion was never done, because approving used to
    // execute the action and return without re-entering the loop. Any task needing
    // more than one write could only ever complete its first write.
    pendingActions = [
      { id: "11111111-1111-1111-1111-111111111111", title: "Create Google Doc", preview: "PS2" },
    ]
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "yes",
      timestamp: new Date().toISOString(),
    })

    expect(approvedActions).toEqual(["11111111-1111-1111-1111-111111111111"])
    expect(agentCalls).toHaveLength(1)
    // The resume must tell the agent what landed and that work may remain.
    expect(agentCalls[0]?.text).toContain("Continue the request")
    expect(agentCalls[0]?.text).toContain("Done: Test action")
    // The user is told the write succeeded, and then gets the finished result.
    expect(adapter.messages.some((m) => m.text?.startsWith("Approved and executed."))).toBe(true)
    expect(adapter.messages.at(-1)?.text).toBe("backend reply")
  })

  it("stops giving away free resumes once the cap is hit", async () => {
    // A resume can propose a further gated write, so approving over and over would
    // otherwise fund an unbounded chain of uncharged agent runs off one paid message.
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    for (let i = 0; i < 10; i++) {
      pendingActions = [{ id: "11111111-1111-1111-1111-111111111111", title: "T", preview: "p" }]
      await incoming(runner, {
        platform: "telegram",
        chatId: "chat_1",
        userId: "tg_1",
        text: "yes",
        timestamp: new Date().toISOString(),
      })
    }

    expect(agentCalls).toHaveLength(10)
    expect(agentCalls.filter((c) => c.skipCharge).length).toBe(8)
    // Past the allowance, the continuation is billed like any other turn.
    expect(agentCalls.slice(8).every((c) => c.skipCharge === false)).toBe(true)
  })

  it("restores the free-resume allowance after a real user turn", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    for (let i = 0; i < 9; i++) {
      pendingActions = [{ id: "11111111-1111-1111-1111-111111111111", title: "T", preview: "p" }]
      await incoming(runner, {
        platform: "telegram",
        chatId: "chat_1",
        userId: "tg_1",
        text: "yes",
        timestamp: new Date().toISOString(),
      })
    }
    expect(agentCalls.at(-1)?.skipCharge).toBe(false)

    // A charged message starts a new task; its writes get the allowance again.
    pendingActions = []
    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "solve my assignment",
      timestamp: new Date().toISOString(),
    })

    pendingActions = [{ id: "11111111-1111-1111-1111-111111111111", title: "T", preview: "p" }]
    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "yes",
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls.at(-1)?.skipCharge).toBe(true)
  })

  it("does not resume the agent when an approval is denied", async () => {
    pendingActions = [{ id: "11111111-1111-1111-1111-111111111111", title: "T", preview: "p" }]
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "no",
      timestamp: new Date().toISOString(),
    })

    expect(approvedActions).toEqual([])
    expect(agentCalls).toHaveLength(0)
  })

  it("lets bare yes continue to the agent when no approval is pending", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "yes",
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls.at(-1)?.text).toBe("yes")
    expect(adapter.messages.at(-1)?.text).toBe("backend reply")
  })

  it("approves pending action with natural affirmative text", async () => {
    pendingActions = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        title: "Create repo",
        preview: "golang-practice",
      },
    ]
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "yes create it",
      timestamp: new Date().toISOString(),
    })

    expect(approvedActions).toEqual(["11111111-1111-1111-1111-111111111111"])
    expect(
      adapter.messages.some((m) => m.text === "Approved and executed.\nDone: Test action"),
    ).toBe(true)
    expect(agentCalls).toHaveLength(1)
  })

  for (const phrase of ["yes", "Yes schedule it", "sure", "ok", "go ahead", "yes please", "do it"]) {
    it(`approves a pending action with "${phrase}"`, async () => {
      pendingActions = [{ id: "11111111-1111-1111-1111-111111111111", title: "T", preview: "p" }]
      const runner = new GatewayRunner()
      const adapter = new FakeAdapter()
      runner.registerAdapter(adapter)

      await incoming(runner, {
        platform: "telegram",
        chatId: "chat_1",
        userId: "tg_1",
        text: phrase,
        timestamp: new Date().toISOString(),
      })

      expect(approvedActions).toEqual(["11111111-1111-1111-1111-111111111111"])
      // Resumed, not re-billed: the user paid for the turn that proposed the write.
      expect(agentCalls).toHaveLength(1)
      expect(agentCalls[0]?.skipCharge).toBe(true)
    })
  }

  it("sends an amendment like 'yes but change the time' to the agent, not approval", async () => {
    pendingActions = [{ id: "11111111-1111-1111-1111-111111111111", title: "T", preview: "p" }]
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "yes but change the time to 7pm",
      timestamp: new Date().toISOString(),
    })

    expect(approvedActions).toHaveLength(0)
    expect(agentCalls.at(-1)?.text).toBe("yes but change the time to 7pm")
  })

  it("records ai telemetry with vision usage for the image analysis path", async () => {
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url) === "https://img.example.com/pic.jpg") {
        return new Response(new Uint8Array([1, 2, 3]).buffer, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        })
      }
      throw new Error(`unexpected fetch: ${String(url)}`)
    }) as typeof fetch

    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "what is this?",
      imageUrl: "https://img.example.com/pic.jpg",
      imageMimeType: "image/jpeg",
      timestamp: new Date().toISOString(),
    })

    expect(adapter.messages.at(-1)?.text).toBe("It looks like a cat.")
    expect(recordedTelemetry.length).toBe(1)
    expect(recordedTelemetry[0]!["endpoint"]).toBe("gateway.image")
    expect(recordedTelemetry[0]!["surface"]).toBe("telegram")
    expect(recordedTelemetry[0]!["visionImages"]).toBe(1)
    expect(recordedTelemetry[0]!["inputTokens"]).toBe(120)
    expect(recordedTelemetry[0]!["outputTokens"]).toBe(40)
    expect(recordedTelemetry[0]!["userId"]).toBe("user_1")
  })

  it("gives a specific message when the vision model hits its token cap with no visible text", async () => {
    imageAnalysisMode = "empty-length"
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url) === "https://img.example.com/pic.jpg") {
        return new Response(new Uint8Array([1, 2, 3]).buffer, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        })
      }
      throw new Error(`unexpected fetch: ${String(url)}`)
    }) as typeof fetch

    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "post this as my new logo and add getyomi.in as a collaborator",
      imageUrl: "https://img.example.com/pic.jpg",
      imageMimeType: "image/jpeg",
      timestamp: new Date().toISOString(),
    })

    expect(adapter.messages.at(-1)?.text).toBe(
      "That image needed more thinking than I had room for — try asking a shorter, more specific question about it.",
    )
  })

  it("tells the user attachments aren't set up yet when the caption is a task but asset storage is unconfigured", async () => {
    imageAnalysisMode = "action"
    uploadedAsset = null // asset storage not configured
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url) === "https://img.example.com/pic.jpg") {
        return new Response(new Uint8Array([1, 2, 3]).buffer, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        })
      }
      throw new Error(`unexpected fetch: ${String(url)}`)
    }) as typeof fetch

    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "post this as my new logo",
      imageUrl: "https://img.example.com/pic.jpg",
      imageMimeType: "image/jpeg",
      timestamp: new Date().toISOString(),
    })

    expect(adapter.messages.at(-1)?.text).toContain("can't act on attachments yet")
    expect(agentCalls.length).toBe(0)
  })

  it("hands an action-shaped caption to the real agent loop with the uploaded asset's URL", async () => {
    imageAnalysisMode = "action"
    uploadedAsset = {
      key: "assets/user_1/abc.jpg",
      url: "https://getyomi-assets.s3.amazonaws.com/assets/user_1/abc.jpg?X-Amz-Signature=fake",
      contentType: "image/jpeg",
    }
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url) === "https://img.example.com/pic.jpg") {
        return new Response(new Uint8Array([1, 2, 3]).buffer, {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        })
      }
      throw new Error(`unexpected fetch: ${String(url)}`)
    }) as typeof fetch

    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "post this as my new logo",
      imageUrl: "https://img.example.com/pic.jpg",
      imageMimeType: "image/jpeg",
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls.length).toBe(1)
    expect(agentCalls[0]!.text).toContain("post this as my new logo")
    expect(agentCalls[0]!.text).toContain("A blue cat mascot logo")
    expect(agentCalls[0]!.text).toContain(uploadedAsset.url)
    expect(adapter.messages.at(-1)?.text).toBe("backend reply")
  })

  it("uploads with Telegram's own mime type, not a generic content-type header from the file CDN", async () => {
    imageAnalysisMode = "action"
    uploadedAsset = {
      key: "assets/user_1/abc.png",
      url: "https://getyomi-assets.s3.amazonaws.com/assets/user_1/abc.png?X-Amz-Signature=fake",
      contentType: "image/png",
    }
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url) === "https://img.example.com/pic.png") {
        // Telegram's file-download CDN serving a generic type, as it commonly does.
        return new Response(new Uint8Array([1, 2, 3]).buffer, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        })
      }
      throw new Error(`unexpected fetch: ${String(url)}`)
    }) as typeof fetch

    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "post this as my new logo",
      imageUrl: "https://img.example.com/pic.png",
      imageMimeType: "image/png",
      timestamp: new Date().toISOString(),
    })

    expect(capturedUploadContentType).toBe("image/png")
  })
})
