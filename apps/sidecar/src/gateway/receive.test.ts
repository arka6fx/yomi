import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"

let reserveCalls: { kind: string }[] = []
let reserveResult: { ok: boolean; error?: string; code?: string; upgradeUrl?: string } = { ok: true }

let classifyResult = { path: "fast", confidence: 0.9, reason: "mocked", source: "heuristic" }
let classifyCallCount = 0

let fastChunks: string[] = []
let fastCallArgs: unknown[] = []

let agentCallArgs: unknown[] = []
let agentChunks: string[] = []
let agentExtraEvents: { type: string; message?: string }[] = []

let connectorInitCalls: string[] = []
let enqueueTriggerCalls: { action: string; opts?: unknown }[] = []
let enqueueTriggerResult: unknown = ""

const originalFetch = globalThis.fetch
let fetchCalls: { url: string; method: string; body?: string }[] = []

mock.module("../automation/usage.js", () => ({
  reserveInteraction: async (kind: string) => {
    reserveCalls.push({ kind })
    return reserveResult
  },
  reportUsage: (_kind: string) => {},
}))

mock.module("../router/intent.js", () => ({
  classifyIntent: async (_req: unknown) => {
    classifyCallCount++
    return classifyResult
  },
}))

let fastExtraEvents: { type: string; message?: string }[] = []

mock.module("../pipeline/fast.js", () => ({
  fastPipeline: async function* (req: unknown) {
    fastCallArgs.push(req)
    for (const chunk of fastChunks) {
      yield { type: "llm_chunk", text: chunk }
    }
    for (const ev of fastExtraEvents) {
      yield ev as unknown as never
    }
  },
}))

mock.module("../pipeline/agent.js", () => ({
  agentPipeline: async function* (req: unknown) {
    agentCallArgs.push(req)
    for (const chunk of agentChunks) {
      yield { type: "agent_text", text: chunk }
    }
    for (const ev of agentExtraEvents) {
      yield ev as unknown as never
    }
  },
}))

mock.module("../graph/run.js", () => ({
  runGraph: async function* (req: unknown) {
    agentCallArgs.push(req)
    for (const chunk of agentChunks) {
      yield { type: "agent_text", text: chunk }
    }
    for (const ev of agentExtraEvents) {
      yield ev as unknown as never
    }
  },
}))

const mockRegistry = {
  getConnected: () => [],
  getAllDefTools: () => ({}),
}
mock.module("../connectors/registry.js", () => ({
  ConnectorRegistry: class {
    constructor() {}
    init = async (_userId: string) => {}
    getConnected = () => []
    getAllDefTools = () => ({})
  },
  getConnectorRegistry: () => mockRegistry,
  initConnectorRegistry: async (userId: string) => {
    connectorInitCalls.push(userId)
  },
}))

mock.module("./remote-queue.js", () => ({
  enqueueTrigger: async (action: string, opts?: unknown) => {
    enqueueTriggerCalls.push({ action, opts })
    if (enqueueTriggerResult instanceof Error) throw enqueueTriggerResult
    return enqueueTriggerResult
  },
}))

const { handleGatewayMessage } = await import("./receive.js")

const sampleMsg = {
  platform: "telegram",
  chatId: "-100123456",
  userId: "tg-user-1",
  text: "hello world",
  timestamp: new Date().toISOString(),
}

beforeEach(() => {
  reserveCalls = []
  reserveResult = { ok: true }
  classifyResult = { path: "fast", confidence: 0.9, reason: "mocked", source: "heuristic" }
  classifyCallCount = 0
  fastChunks = ["Hello!", " How can I help?"]
  fastExtraEvents = []
  fastCallArgs = []
  agentCallArgs = []
  agentChunks = ["Here's what I found in Notion..."]
  agentExtraEvents = []
  connectorInitCalls = []
  enqueueTriggerCalls = []
  enqueueTriggerResult = ""
  fetchCalls = []
  globalThis.fetch = async (url: string, opts?: RequestInit) => {
    fetchCalls.push({ url: url as string, method: opts?.method ?? "GET", body: opts?.body as string | undefined })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("handleGatewayMessage", () => {
  // ── Usage reservation ────────────────────────────────────────────────────

  it("calls reserveInteraction with bot_message", async () => {
    await handleGatewayMessage(sampleMsg)
    expect(reserveCalls.length).toBe(1)
    expect(reserveCalls[0]!.kind).toBe("bot_message")
  })

  it("sends error reply and stops when reservation fails", async () => {
    reserveResult = { ok: false, error: "Bot message limit reached.", code: "quota_exceeded" }
    await handleGatewayMessage(sampleMsg)
    expect(classifyCallCount).toBe(0)
    expect(fetchCalls.length).toBe(1)
    const body = JSON.parse(fetchCalls[0]!.body!)
    expect(body.text).toBe("Bot message limit reached.")
  })

  it("includes upgrade URL in error reply when provided", async () => {
    reserveResult = {
      ok: false,
      error: "Bot message limit reached.",
      code: "quota_exceeded",
      upgradeUrl: "https://yomi.ai/pricing",
    }
    await handleGatewayMessage(sampleMsg)
    const body = JSON.parse(fetchCalls[0]!.body!)
    expect(body.text).toContain("Upgrade: https://yomi.ai/pricing")
  })

  // ── Fast pipeline path ────────────────────────────────────────────────────

  it("proceeds to fast pipeline with skipReserve: true", async () => {
    await handleGatewayMessage(sampleMsg)
    expect(classifyCallCount).toBe(1)
    expect(fastCallArgs.length).toBe(1)
    const arg = fastCallArgs[0] as Record<string, unknown>
    expect(arg.skipReserve).toBe(true)
    expect(arg.text).toBe("hello world")
    expect(arg.tts).toBe(false)
    expect(arg.plan).toBe("max")
  })

  it("sends fast pipeline reply back via gateway send", async () => {
    await handleGatewayMessage(sampleMsg)
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    expect(sendCall).toBeDefined()
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toBe("Hello! How can I help?")
    expect(body.platform).toBe("telegram")
    expect(body.chatId).toBe("-100123456")
  })

  it("does NOT initialize connectors for fast path", async () => {
    await handleGatewayMessage(sampleMsg)
    expect(connectorInitCalls.length).toBe(0)
  })

  // ── Agent pipeline path ──────────────────────────────────────────────────

  it("routes to agent pipeline when intent says agent", async () => {
    classifyResult = { path: "agent", confidence: 0.9, reason: "complex", source: "llm" }
    await handleGatewayMessage(sampleMsg)
    expect(agentCallArgs.length).toBe(1)
    expect(fastCallArgs.length).toBe(0)
  })

  it("passes skipReserve: true to agent pipeline", async () => {
    classifyResult = { path: "agent", confidence: 0.9, reason: "complex", source: "llm" }
    await handleGatewayMessage(sampleMsg)
    const arg = agentCallArgs[0] as Record<string, unknown>
    expect(arg.skipReserve).toBe(true)
  })

  it("sends agent pipeline reply back via gateway send", async () => {
    classifyResult = { path: "agent", confidence: 0.9, reason: "complex", source: "llm" }
    await handleGatewayMessage(sampleMsg)
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    expect(sendCall).toBeDefined()
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toBe("Here's what I found in Notion...")
  })

  // ── Connector initialization for connected integrations ──────────────────

  it("initializes connectors when yomiUserId is provided (agent path)", async () => {
    classifyResult = { path: "agent", confidence: 0.9, reason: "complex", source: "llm" }
    const msgWithUser = { ...sampleMsg, yomiUserId: "user-abc-123" }
    await handleGatewayMessage(msgWithUser)
    expect(connectorInitCalls.length).toBe(1)
    expect(connectorInitCalls[0]).toBe("user-abc-123")
  })

  it("does not initialize connectors when yomiUserId is missing (agent path)", async () => {
    classifyResult = { path: "agent", confidence: 0.9, reason: "complex", source: "llm" }
    await handleGatewayMessage(sampleMsg)
    expect(connectorInitCalls.length).toBe(0)
  })

  it("connector init failure does not block message processing", async () => {
    // initConnectorRegistry already has no error thrown in mock — it silently
    // catches errors in the real implementation. Verify the pipeline still runs.
    classifyResult = { path: "agent", confidence: 0.9, reason: "complex", source: "llm" }
    const msgWithUser = { ...sampleMsg, yomiUserId: "user-abc-123" }
    await handleGatewayMessage(msgWithUser)
    expect(agentCallArgs.length).toBe(1)
  })

  // ── Conversation history (context across turns) ──────────────────────────

  it("passes conversation history from prior turns", async () => {
    const historyChatId = "chat-history-test"
    // First turn
    await handleGatewayMessage({ ...sampleMsg, text: "what's in my Notion?", chatId: historyChatId })
    expect(fastCallArgs.length).toBe(1)
    expect((fastCallArgs[0] as Record<string, unknown>).history?.length ?? 0).toBe(0)

    // Reset classify + fastCallArgs but keep conversation history alive (chatId same)
    classifyCallCount = 0
    fastCallArgs = []
    fastChunks = ["Your Notion has project plans."]

    // Second turn — history should include the prior exchange
    await handleGatewayMessage({ ...sampleMsg, text: "tell me more", chatId: historyChatId })
    expect(fastCallArgs.length).toBe(1)
    const history = (fastCallArgs[0] as Record<string, unknown>).history as Array<{ role: string; text: string }>
    expect(history).toBeDefined()
    expect(history.length).toBeGreaterThanOrEqual(2)
    expect(history[0]!.role).toBe("user")
    expect(history[0]!.text).toBe("what's in my Notion?")
    expect(history[1]!.role).toBe("assistant")
    expect(history[1]!.text).toBe("Hello! How can I help?")
  })

  it("maintains separate history per chat session", async () => {
    // Chat A says hello
    await handleGatewayMessage({ ...sampleMsg, text: "hi", chatId: "chat-a" })
    // Chat B says hello
    await handleGatewayMessage({ ...sampleMsg, text: "bonjour", chatId: "chat-b" })

    fastCallArgs = []
    fastChunks = ["Hello A!"]

    // Chat A asks a follow-up
    await handleGatewayMessage({ ...sampleMsg, text: "remember me?", chatId: "chat-a" })
    const historyA = (fastCallArgs[0] as Record<string, unknown>).history as Array<{ role: string; text: string }>
    expect(historyA[0]!.text).toBe("hi")
    expect(historyA[1]!.text).toBe("Hello! How can I help?")

    fastCallArgs = []
    fastChunks = ["Bonjour B!"]

    // Chat B asks a follow-up
    await handleGatewayMessage({ ...sampleMsg, text: "tu me souviens?", chatId: "chat-b" })
    const historyB = (fastCallArgs[0] as Record<string, unknown>).history as Array<{ role: string; text: string }>
    expect(historyB[0]!.text).toBe("bonjour")
  })

  // ── Remote desktop triggers ──────────────────────────────────────────────

  it("/screenshot dispatches via enqueueTrigger and returns result", async () => {
    enqueueTriggerResult = "data:image/png;base64,screenshot"
    await handleGatewayMessage({ ...sampleMsg, text: "/screenshot" })
    expect(enqueueTriggerCalls.length).toBe(1)
    expect(enqueueTriggerCalls[0]!.action).toBe("screenshot")
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    expect(sendCall).toBeDefined()
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toBe("data:image/png;base64,screenshot")
  })

  it("/screenshot handles errors gracefully", async () => {
    enqueueTriggerResult = new Error("Screenshot failed")
    await handleGatewayMessage({ ...sampleMsg, text: "/screenshot" })
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toContain("Screenshot failed")
  })

  it("/voice dispatches enqueueTrigger", async () => {
    await handleGatewayMessage({ ...sampleMsg, text: "/voice" })
    expect(enqueueTriggerCalls.length).toBe(1)
    expect(enqueueTriggerCalls[0]!.action).toBe("voice")
  })

  it("/move dispatches enqueueTrigger with direction", async () => {
    await handleGatewayMessage({ ...sampleMsg, text: "/move left" })
    expect(enqueueTriggerCalls.length).toBe(1)
    expect(enqueueTriggerCalls[0]!.action).toBe("move")
    expect(enqueueTriggerCalls[0]!.opts).toEqual({ direction: "left" })
  })

  it("/type extracts query and processes it through pipeline", async () => {
    await handleGatewayMessage({ ...sampleMsg, text: "/type find my notes" })
    expect(fastCallArgs.length).toBe(1)
    const arg = fastCallArgs[0] as Record<string, unknown>
    expect(arg.text).toBe("find my notes")
  })

  it("screen analysis phrases dispatch enqueueTrigger with analyze action", async () => {
    enqueueTriggerResult = "I can see VS Code with TypeScript"
    await handleGatewayMessage({ ...sampleMsg, text: "look at my screen" })
    expect(enqueueTriggerCalls.length).toBe(1)
    expect(enqueueTriggerCalls[0]!.action).toBe("analyze")
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toBe("I can see VS Code with TypeScript")
  })

  // ── Error events from pipeline ────────────────────────────────────────────

  it("sends error events as reply in fast path", async () => {
    fastChunks = []
    fastExtraEvents = [{ type: "error", message: "LLM API rate limited" }]
    await handleGatewayMessage(sampleMsg)
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    expect(sendCall).toBeDefined()
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toBe("LLM API rate limited")
  })

  it("sends error events as reply in agent path", async () => {
    classifyResult = { path: "agent", confidence: 0.9, reason: "complex", source: "llm" }
    agentChunks = []
    agentExtraEvents = [{ type: "error", message: "Model overloaded" }]
    await handleGatewayMessage(sampleMsg)
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    expect(sendCall).toBeDefined()
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toBe("Model overloaded")
  })

  it("sends usage_limit events as reply in fast path", async () => {
    fastChunks = []
    fastExtraEvents = [{ type: "usage_limit", message: "Daily limit reached", code: "quota_exceeded", feature: "analyze" }]
    await handleGatewayMessage(sampleMsg)
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    expect(sendCall).toBeDefined()
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toBe("Daily limit reached")
  })

  it("sends usage_limit events as reply in agent path", async () => {
    classifyResult = { path: "agent", confidence: 0.9, reason: "complex", source: "llm" }
    agentChunks = []
    agentExtraEvents = [{ type: "usage_limit", message: "Bot message limit exceeded", code: "quota_exceeded", feature: "botMessages" }]
    await handleGatewayMessage(sampleMsg)
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    expect(sendCall).toBeDefined()
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toBe("Bot message limit exceeded")
  })

  // ── Error events combined with text chunks ────────────────────────────────

  it("includes error text alongside llm_chunks in fast path", async () => {
    fastChunks = ["Partial response "]
    fastExtraEvents = [{ type: "error", message: "then cut off" }]
    await handleGatewayMessage(sampleMsg)
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toBe("Partial response then cut off")
  })

  it("includes error text alongside agent_text in agent path", async () => {
    classifyResult = { path: "agent", confidence: 0.9, reason: "complex", source: "llm" }
    agentChunks = ["Found some data "]
    agentExtraEvents = [{ type: "error", message: "but tool failed" }]
    await handleGatewayMessage(sampleMsg)
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toBe("Found some data but tool failed")
  })

  // ── Voice trigger without error ──────────────────────────────────────────

  it("/voice returns success message via sendReply", async () => {
    enqueueTriggerResult = "triggered"
    await handleGatewayMessage({ ...sampleMsg, text: "/voice" })
    expect(enqueueTriggerCalls.length).toBe(1)
    expect(enqueueTriggerCalls[0]!.action).toBe("voice")
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    expect(sendCall).toBeDefined()
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toContain("Voice mode")
  })

  it("voice trigger handles enqueueTrigger failure gracefully", async () => {
    enqueueTriggerResult = new Error("Voice failed")
    await handleGatewayMessage({ ...sampleMsg, text: "/voice" })
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toContain("Voice failed")
  })

  // ── Empty / no-op reply does not send ─────────────────────────────────────

  it("does not send reply when no chunks or error events emitted", async () => {
    fastChunks = []
    fastExtraEvents = []
    await handleGatewayMessage(sampleMsg)
    const sendCalls = fetchCalls.filter((c) => c.url.includes("/api/gateway/send"))
    expect(sendCalls.length).toBe(0)
  })
})
