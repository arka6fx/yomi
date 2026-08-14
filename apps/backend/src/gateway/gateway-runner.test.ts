import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { GatewayMessage, PlatformType } from "@yomi/shared"
import type { AgentMessage } from "@yomi/agent-core"
import type { PlatformAdapter, InlineButton, PlatformCallbackEvent } from "./platform-adapter.js"

let agentCalls: {
  userId: string
  text: string
  history?: AgentMessage[]
  signal?: AbortSignal
  skipCharge?: boolean
}[] = []
let agentHangs = false
// When true (only meaningful alongside agentHangs), the mock's abort listener
// rejects instead of resolving — mirrors a runAgent() that throws on abort,
// so tests can independently exercise onIncoming's catch-block abort path
// rather than assuming it behaves like the try-block's post-await path just
// because the code looks parallel.
let agentRejectsOnAbort = false
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
let capturedOnReact: ((emoji: string) => Promise<void>) | undefined
let capturedConsumePendingDocument: (() => { title: string; content: string } | null) | undefined
let capturedRestorePendingDocument:
  | ((document: { title: string; content: string }) => void)
  | undefined
// Overrides the fast path's fake model text for a single test; null falls back
// to the default "NEED_AGENT" (forces the full agent loop) for non-image text.
let fastReplyOverride: string | null = null
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
          then: (
            resolve: (
              rows: { id: string; userId: string; plan: string; subscriptionStatus: string }[],
            ) => unknown,
          ) =>
            // plan: "max" + subscriptionStatus: "active" makes hasBillablePlanAccess() true for
            // featureQuotaBlock's user lookup — no test here exercises billing gate logic.
            Promise.resolve(
              resolve([
                { id: "conn_1", userId: "user_1", plan: "max", subscriptionStatus: "active" },
              ]),
            ),
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
    onReact,
    consumePendingDocument,
    restorePendingDocument,
  }: {
    userId: string
    text: string
    history?: AgentMessage[]
    signal?: AbortSignal
    skipCharge?: boolean
    onReact?: (emoji: string) => Promise<void>
    consumePendingDocument?: () => { title: string; content: string } | null
    restorePendingDocument?: (document: { title: string; content: string }) => void
  }) => {
    agentCalls.push({ userId, text, history, signal, skipCharge })
    capturedOnReact = onReact
    capturedConsumePendingDocument = consumePendingDocument
    capturedRestorePendingDocument = restorePendingDocument
    if (agentHangs) {
      if (agentRejectsOnAbort) {
        // Exercises onIncoming's catch-block abort path independently of the
        // try-block's post-await path, which the real runAgent() never hits
        // (it always resolves) but which the code still has to handle.
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) return reject(new Error("aborted"))
          signal?.addEventListener("abort", () => reject(new Error("aborted")))
        })
        return { text: "" }
      }
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

// gateway-runner.ts's only runtime imports from @yomi/agent-core are createModel
// and ALLOWED_REACTIONS (AgentMessage is type-only); no other file in this test's
// import graph reaches the real package, so it's safe to replace wholesale. The
// real generateText()
// (from "ai", left un-mocked) calls this fake model's doGenerate, so it completes
// without touching the network. Image messages (content is an array with an
// "image" part) get a canned vision reply + usage; anything else mimics
// NEED_AGENT so the existing fast-path-falls-through-to-agent tests still work.
mock.module("@yomi/agent-core", () => ({
  ALLOWED_REACTIONS: ["👍", "❤️", "🔥"],
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
        text: isImage ? "It looks like a cat." : (fastReplyOverride ?? "NEED_AGENT"),
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
    balance: 100,
    lifetimeGranted: 100,
    lifetimeConsumed: 0,
    lifetimeRefunded: 0,
    expiringSoon: 0,
    expiringSoonAt: null,
  }),
  grantCredits: async () => ({ granted: true, balance: 100 }),
  recentCreditTransactions: async () => [],
  expireUserCredits: async () => 0,
  expireCredits: async () => 0,
}))

let recordDailyActivityCalls: string[] = []
mock.module("../services/streaks.js", () => ({
  recordDailyActivity: async (userId: string) => {
    recordDailyActivityCalls.push(userId)
  },
}))

const { GatewayRunner } = await import("./gateway-runner.js")

class FakeAdapter implements PlatformAdapter {
  readonly platform: PlatformType = "telegram"
  messages: { chatId: string; text: string; buttons?: InlineButton[][] }[] = []
  reactions: { chatId: string; messageId: string; emoji: string }[] = []
  edits: { chatId: string; messageId: string; text: string; buttons?: InlineButton[][] }[] = []
  deletedMessageIds: string[] = []
  answeredCallbacks: string[] = []
  handler: ((msg: GatewayMessage) => void | Promise<void>) | null = null
  callbackHandler: ((event: PlatformCallbackEvent) => void | Promise<void>) | null = null
  private nextMessageId = 1
  async connect() {}
  async disconnect() {}
  setMessageHandler(handler: (msg: GatewayMessage) => void | Promise<void>): void {
    this.handler = handler
  }
  setCallbackHandler(handler: (event: PlatformCallbackEvent) => void | Promise<void>): void {
    this.callbackHandler = handler
  }
  async sendMessage(chatId: string, text: string, options?: { buttons?: InlineButton[][] }) {
    const messageId = String(this.nextMessageId++)
    this.messages.push({ chatId, text, buttons: options?.buttons })
    return { ok: true, messageId }
  }
  async sendDocument() {
    return { ok: true }
  }
  async deleteMessage(_chatId: string, messageId: string) {
    this.deletedMessageIds.push(messageId)
    return { ok: true }
  }
  async editMessageText(
    chatId: string,
    messageId: string,
    text: string,
    options?: { buttons?: InlineButton[][] },
  ) {
    this.edits.push({ chatId, messageId, text, buttons: options?.buttons })
    return { ok: true }
  }
  markupClears: { chatId: string; messageId: string }[] = []
  async editMessageReplyMarkup(chatId: string, messageId: string) {
    this.markupClears.push({ chatId, messageId })
    return { ok: true }
  }
  async answerCallbackQuery(callbackId: string) {
    this.answeredCallbacks.push(callbackId)
  }
  async sendTyping() {}
  async setReaction(chatId: string, messageId: string, emoji: string) {
    this.reactions.push({ chatId, messageId, emoji })
    return { ok: true }
  }
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
  agentRejectsOnAbort = false
  delete process.env.YOMI_AGENT_RUN_TIMEOUT_MS
  loadedHistory = []
  appendedTurns = []
  closedSessions = []
  pendingActions = []
  approvedActions = []
  deniedActions = []
  soulCalls = []
  soulOnboardingReply = null
  capturedOnReact = undefined
  capturedConsumePendingDocument = undefined
  capturedRestorePendingDocument = undefined
  fastReplyOverride = null
  imageAnalysisMode = "normal"
  uploadedAsset = null
  capturedUploadContentType = null
  recordedTelemetry.length = 0
  recordDailyActivityCalls = []
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

  it("records daily activity for the resolved user on every incoming message from a linked user", async () => {
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

    expect(recordDailyActivityCalls).toEqual(["user_1"])
  })

  it("still records daily activity for a bare command that short-circuits before the agent", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "/help",
      timestamp: new Date().toISOString(),
    })

    expect(recordDailyActivityCalls).toEqual(["user_1"])
  })

  it.each(["/stop", "/new", "/help", "/start"])(
    "replies locally to bare %s without reaching the agent path",
    async (command) => {
      const runner = new GatewayRunner()
      const adapter = new FakeAdapter()
      runner.registerAdapter(adapter)

      await incoming(runner, {
        platform: "telegram",
        chatId: "chat_1",
        userId: "tg_1",
        text: command,
        timestamp: new Date().toISOString(),
      })

      expect(agentCalls).toEqual([])
      expect(adapter.messages).toHaveLength(1)
      expect(adapter.messages[0]?.text).toBe(
        "Use the buttons on my messages — tap Stop, New chat, Approve, or Deny instead of typing commands.",
      )
    },
  )

  it("leaves the /start <TOKEN> deep-link form unaffected by the bare /start intercept", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "/start aTokenThatIsLongEnough1234",
      timestamp: new Date().toISOString(),
    })

    // Never reaches the paid agent path, and never gets the "use the buttons"
    // local reply either — it's a wholly separate, already-preserved code path.
    expect(agentCalls).toEqual([])
    expect(adapter.messages.some((m) => m.text.includes("Use the buttons"))).toBe(false)
  })

  it("wires onReact through to the platform adapter's setReaction", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      messageId: "msg_100",
      text: "thanks!",
      timestamp: new Date().toISOString(),
    })

    expect(capturedOnReact).toBeDefined()
    await capturedOnReact?.("🔥")

    expect(adapter.reactions).toEqual([{ chatId: "chat_1", messageId: "msg_100", emoji: "🔥" }])
  })

  it("no-ops onReact when the inbound message has no messageId", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "thanks!",
      timestamp: new Date().toISOString(),
    })

    await capturedOnReact?.("🔥")

    expect(adapter.reactions).toEqual([])
  })

  it("reacts on the fast path when the cheap model emits a REACT line", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)
    fastReplyOverride = "REACT:🔥\nYou're very welcome!"

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      messageId: "msg_200",
      text: "thank you so much, you're a lifesaver",
      timestamp: new Date().toISOString(),
    })

    expect(adapter.reactions).toEqual([{ chatId: "chat_1", messageId: "msg_200", emoji: "🔥" }])
    expect(adapter.messages.at(-1)?.text).toBe("You're very welcome!")
    // Handled entirely by the fast path — never reached the full agent loop.
    expect(agentCalls).toEqual([])
  })

  it("ignores a REACT line with an emoji outside the allowed set", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)
    fastReplyOverride = "REACT:🍑\nYou're very welcome!"

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      messageId: "msg_201",
      text: "thank you",
      timestamp: new Date().toISOString(),
    })

    expect(adapter.reactions).toEqual([])
    expect(adapter.messages.at(-1)?.text).toBe("You're very welcome!")
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

  it("reacts instantly with the sticker's own emoji and feeds it into the agent turn as context", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      messageId: "msg_300",
      text: "",
      sticker: { emoji: "🔥", setName: "FunPack" },
      timestamp: new Date().toISOString(),
    })

    expect(adapter.reactions).toEqual([{ chatId: "chat_1", messageId: "msg_300", emoji: "🔥" }])
    expect(agentCalls[0]?.text).toBe('🧩 _Sticker:_ 🔥 (from "FunPack")')
  })

  it("falls back to a default reaction emoji when the sticker's own emoji isn't in the allowed reaction set", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      messageId: "msg_301",
      text: "",
      sticker: { emoji: "🍑" },
      timestamp: new Date().toISOString(),
    })

    expect(adapter.reactions).toEqual([{ chatId: "chat_1", messageId: "msg_301", emoji: "😁" }])
    expect(agentCalls[0]?.text).toBe("🧩 _Sticker:_ 🍑")
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
    // Status message ("1") is sent before the run and must be deleted once the
    // timeout fires — this is the try-block's post-await timeout branch, which
    // is distinct from the manual-Stop-tap path (that one leaves the status
    // message alone because handleCallbackQuery already edited it in place).
    expect(adapter.deletedMessageIds).toEqual(["1"])
    expect(adapter.messages.at(-1)?.text).toMatch(/too long/i)
  })

  it("deletes the status message via the catch-block timeout path when runAgent rejects after timing out", async () => {
    process.env.YOMI_AGENT_RUN_TIMEOUT_MS = "30"
    agentHangs = true
    agentRejectsOnAbort = true
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
    // Proves the catch block's OWN `if (runTimedOut) { deleteMessage... }`
    // branch independently — this run throws (agentRejectsOnAbort), landing
    // in the catch block rather than the try block's post-await branch above.
    expect(adapter.deletedMessageIds).toEqual(["1"])
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

  it("closes the active persisted session when the New-chat button is tapped", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "hello",
      timestamp: new Date().toISOString(),
    })
    expect(adapter.messages.at(-1)?.buttons).toEqual([
      [{ text: "🔄 New chat", callbackData: "new" }],
    ])

    // FakeAdapter's message ids are assigned in send order: "1" was the status
    // placeholder (sent, then deleted once the run finished), "2" is the final
    // reply the New-chat button is actually attached to.
    await adapter.callbackHandler!({
      chatId: "chat_1",
      platformUserId: "tg_1",
      messageId: "2",
      data: "new",
      callbackId: "cbq_1",
    })

    expect(adapter.answeredCallbacks).toEqual(["cbq_1"])
    expect(closedSessions).toEqual([
      { userId: "user_1", platform: "telegram", chatId: "chat_1" },
      { userId: "user_1", platform: "yomi", chatId: "global" },
    ])
    // The tapped message is marked in place, but the real confirmation is a fresh
    // message at the bottom of the chat — visible no matter which reply's button
    // was actually tapped.
    expect(adapter.edits.at(-1)?.text).toBe("✅ Started a new conversation.")
    expect(adapter.messages.at(-1)?.text).toBe("Started a new conversation. How can I help you?")
  })

  it("strips the previous reply's New-chat button when a new reply's button is sent", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "hello",
      timestamp: new Date().toISOString(),
    })
    // FakeAdapter's message ids are assigned in send order: "1" is the status
    // placeholder, "2" is the first reply carrying the New-chat button.
    expect(adapter.markupClears).toEqual([])

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "hello again",
      timestamp: new Date().toISOString(),
    })

    expect(adapter.markupClears).toEqual([{ chatId: "chat_1", messageId: "2" }])
    expect(adapter.messages.at(-1)?.buttons).toEqual([
      [{ text: "🔄 New chat", callbackData: "new" }],
    ])
  })

  it("sends a status message with a Stop button before running the agent, and deletes it once the reply is sent", async () => {
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

    expect(adapter.messages).toHaveLength(2)
    expect(adapter.messages[0]).toEqual({
      chatId: "chat_1",
      text: "⏳ Working on it…",
      buttons: [[{ text: "⏹ Stop", callbackData: "stop" }]],
    })
    expect(adapter.deletedMessageIds).toEqual(["1"])
    expect(adapter.messages[1]).toEqual({
      chatId: "chat_1",
      text: "backend reply",
      buttons: [[{ text: "🔄 New chat", callbackData: "new" }]],
    })
  })

  it("aborts the run when the Stop button is tapped while it's in flight", async () => {
    agentHangs = true
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    const runPromise = incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "do something slow",
      timestamp: new Date().toISOString(),
    })

    // Let the status message send and the runAgent mock start waiting on abort.
    await new Promise((resolve) => setTimeout(resolve, 0))

    await adapter.callbackHandler!({
      chatId: "chat_1",
      platformUserId: "tg_1",
      messageId: "1",
      data: "stop",
      callbackId: "cbq_stop",
    })
    await runPromise

    expect(adapter.answeredCallbacks).toEqual(["cbq_stop"])
    expect(adapter.edits.at(-1)).toEqual({
      chatId: "chat_1",
      messageId: "1",
      text: "Stopping the current operation.",
      buttons: undefined,
    })
    // The aborted run exits quietly — it must not also send a timeout/error message.
    expect(adapter.messages).toHaveLength(1)
  })

  it("also exits quietly from the catch block's mirrored abort check when runAgent rejects after a Stop tap", async () => {
    // Mirrors the test above, but forces runAgent to reject (rather than
    // resolve) once aborted, so this exercises the catch block's own
    // `if (runController?.signal.aborted) return` independently — proving it
    // behaves the same as the try block's post-await path rather than just
    // assuming so because the code looks parallel. The real runAgent()
    // essentially never rejects, but the code still has to handle it.
    agentHangs = true
    agentRejectsOnAbort = true
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    const runPromise = incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "do something slow",
      timestamp: new Date().toISOString(),
    })

    // Let the status message send and the runAgent mock start waiting on abort.
    await new Promise((resolve) => setTimeout(resolve, 0))

    await adapter.callbackHandler!({
      chatId: "chat_1",
      platformUserId: "tg_1",
      messageId: "1",
      data: "stop",
      callbackId: "cbq_stop_reject",
    })
    await runPromise

    expect(adapter.answeredCallbacks).toEqual(["cbq_stop_reject"])
    expect(adapter.edits.at(-1)).toEqual({
      chatId: "chat_1",
      messageId: "1",
      text: "Stopping the current operation.",
      buttons: undefined,
    })
    // The catch block's abort branch must not delete the status message (it
    // was already edited in place by handleCallbackQuery) and must not send
    // any further message.
    expect(adapter.deletedMessageIds).toEqual([])
    expect(adapter.messages).toHaveLength(1)
  })

  it("deletes the in-flight run's status placeholder when New-chat is tapped mid-run", async () => {
    // Regression: New-chat's button lives on a PREVIOUS turn's reply, not on the
    // in-flight run's own "Working on it…" placeholder — unlike Stop (which edits
    // its own message), New used to only abort the run and never touch that
    // placeholder, leaving it dangling forever with a dead Stop button.
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    // First turn completes normally: id "1" is its status placeholder (sent then
    // deleted), id "2" is the reply carrying the New-chat button.
    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "hello",
      timestamp: new Date().toISOString(),
    })
    expect(adapter.deletedMessageIds).toEqual(["1"])

    // Second turn hangs: id "3" is ITS status placeholder, still in flight.
    agentHangs = true
    const runPromise = incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "do something slow",
      timestamp: new Date().toISOString(),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Tap New-chat on the FIRST turn's reply (id "2") while the second run is
    // still in flight — mirrors a user impatiently starting over mid-run.
    await adapter.callbackHandler!({
      chatId: "chat_1",
      platformUserId: "tg_1",
      messageId: "2",
      data: "new",
      callbackId: "cbq_new",
    })
    await runPromise

    // The second run's own placeholder (id "3") must be cleaned up, not left
    // dangling — not just id "1" from the unrelated first turn.
    expect(adapter.deletedMessageIds).toEqual(["1", "3"])
    expect(adapter.edits.at(-1)).toEqual({
      chatId: "chat_1",
      messageId: "2",
      text: "✅ Started a new conversation.",
      buttons: undefined,
    })
    expect(adapter.messages.at(-1)?.text).toBe("Started a new conversation. How can I help you?")
  })

  it("tells the user nothing is running when Stop is tapped with no active run", async () => {
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

    await adapter.callbackHandler!({
      chatId: "chat_1",
      platformUserId: "tg_1",
      messageId: "999",
      data: "stop",
      callbackId: "cbq_stop2",
    })

    expect(adapter.edits.at(-1)).toEqual({
      chatId: "chat_1",
      messageId: "999",
      text: "No operation is currently running.",
      buttons: undefined,
    })
  })

  it("acks an unrecognized callback_data value without throwing or editing anything", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await adapter.callbackHandler!({
      chatId: "chat_1",
      platformUserId: "tg_1",
      messageId: "1",
      data: "some-future-button-type",
      callbackId: "cbq_unknown",
    })

    // Still acked (so the tap spinner clears), but nothing matches, so nothing else happens.
    expect(adapter.answeredCallbacks).toEqual(["cbq_unknown"])
    expect(adapter.edits).toHaveLength(0)
    expect(closedSessions).toHaveLength(0)
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

  for (const phrase of [
    "yes",
    "Yes schedule it",
    "sure",
    "ok",
    "go ahead",
    "yes please",
    "do it",
  ]) {
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

  it("stashes an uploaded document's extracted text so index_document can consume it once", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)
    globalThis.fetch = (async () =>
      new Response("Hello world content", { status: 200 })) as typeof fetch

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "",
      timestamp: new Date().toISOString(),
      documentUrl: "https://example.com/notes.txt",
      documentFileName: "notes.txt",
      documentMimeType: "text/plain",
    })

    expect(capturedConsumePendingDocument).toBeDefined()
    expect(capturedConsumePendingDocument!()).toEqual({
      title: "notes.txt",
      content: "Hello world content",
    })
    // Consumed once — a second call finds nothing left to return.
    expect(capturedConsumePendingDocument!()).toBeNull()
  })

  it("keeps a stashed document scoped to its own conversation", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)
    globalThis.fetch = (async () =>
      new Response("Chat 1's document", { status: 200 })) as typeof fetch

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "",
      timestamp: new Date().toISOString(),
      documentUrl: "https://example.com/notes.txt",
      documentFileName: "notes.txt",
      documentMimeType: "text/plain",
    })

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_2",
      userId: "tg_2",
      text: "index the document",
      timestamp: new Date().toISOString(),
    })

    expect(capturedConsumePendingDocument).toBeDefined()
    expect(capturedConsumePendingDocument!()).toBeNull()
  })

  it("expires a stashed document after PENDING_DOCUMENT_TTL_MS", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)
    globalThis.fetch = (async () => new Response("Old content", { status: 200 })) as typeof fetch

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "",
      timestamp: new Date().toISOString(),
      documentUrl: "https://example.com/notes.txt",
      documentFileName: "notes.txt",
      documentMimeType: "text/plain",
    })

    const consume = capturedConsumePendingDocument!
    const realDateNow = Date.now
    Date.now = () => realDateNow() + 16 * 60 * 1000
    try {
      expect(consume()).toBeNull()
    } finally {
      Date.now = realDateNow
    }
  })

  it("makes a restored document consumable again", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)
    globalThis.fetch = (async () => new Response("Retry me", { status: 200 })) as typeof fetch

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "",
      timestamp: new Date().toISOString(),
      documentUrl: "https://example.com/notes.txt",
      documentFileName: "notes.txt",
      documentMimeType: "text/plain",
    })

    const consume = capturedConsumePendingDocument!
    const restore = capturedRestorePendingDocument!
    const consumed = consume()
    expect(consumed).toEqual({ title: "notes.txt", content: "Retry me" })
    expect(consume()).toBeNull()

    restore(consumed!)

    expect(consume()).toEqual({ title: "notes.txt", content: "Retry me" })
  })
})
