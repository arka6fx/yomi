import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { GatewayMessage, PlatformType } from "@yomi/shared"
import type { AgentMessage } from "@yomi/agent-core"
import type { PlatformAdapter } from "./platform-adapter.js"

let agentCalls: { userId: string; text: string; history?: AgentMessage[]; signal?: AbortSignal }[] =
  []
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
  }: {
    userId: string
    text: string
    history?: AgentMessage[]
    signal?: AbortSignal
  }) => {
    agentCalls.push({ userId, text, history, signal })
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
    return { id, status: "executed" }
  },
  denyPendingAction: async (_userId: string, id: string) => {
    deniedActions.push(id)
    return { id, status: "denied" }
  },
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
    provider: "ai-credits",
    modelId: "test-model",
    defaultObjectGenerationMode: "json",
    async doGenerate(options: { prompt: Array<{ content: unknown }> }) {
      const last = options.prompt[options.prompt.length - 1]
      const isImage =
        Array.isArray(last?.content) &&
        (last.content as Array<{ type?: string }>).some((c) => c.type === "image")
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
  recordedTelemetry.length = 0
  delete process.env.YOMI_GATEWAY_DIRECT_SIDECAR
  globalThis.fetch = (async () => {
    throw new Error("sidecar fetch should not run")
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("GatewayRunner production routing", () => {
  it("runs backend agent for normal Telegram messages without direct sidecar forwarding", async () => {
    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
    runner.setSidecarResolver(async () => "http://sidecar.invalid")
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

  it("intercepts a first-contact message with the personality ask and skips the agent", async () => {
    soulOnboardingReply = "Hey, I'm Yomi. Define my personality?"
    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
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

  it("handles former desktop actions with the backend agent instead of queueing", async () => {
    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
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
    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
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
    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
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
    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
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
    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "/approve",
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls).toHaveLength(0)
    expect(approvedActions).toEqual(["11111111-1111-1111-1111-111111111111"])
    expect(adapter.messages.at(-1)?.text).toContain("Approved")
  })

  it("approves the only pending action with /approve", async () => {
    pendingActions = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        title: "Send email",
        preview: "To: a@example.com",
      },
    ]
    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
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
    expect(adapter.messages.at(-1)?.text).toBe("Approved and executed.")
  })

  it("lets bare yes continue to the agent when no approval is pending", async () => {
    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
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
    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "yes create it",
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls).toHaveLength(0)
    expect(approvedActions).toEqual(["11111111-1111-1111-1111-111111111111"])
    expect(adapter.messages.at(-1)?.text).toBe("Approved and executed.")
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

    const runner = new GatewayRunner("http://sidecar.invalid", "secret")
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
})
