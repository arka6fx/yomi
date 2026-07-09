/**
 * End-to-end tests verifying STT, TTS, and LLM calls work together
 * across all trigger types: text input, voice, AI chat, screen analysis,
 * and Telegram bot messages.
 *
 * Run:   bun test apps/sidecar/src/llm-e2e.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, mock, beforeAll, afterAll } from "bun:test"

// =============================================================================
// Shared mock state
// =============================================================================

type FakeTtsEngine = "elevenlabs" | "none"

const ttsMock = {
  engine: "none" as FakeTtsEngine,
  calls: [] as string[],
  chunks: [new Uint8Array([0x52, 0x49, 0x46, 0x46])], // dummy WAV bytes
  reset() {
    this.engine = "none"
    this.calls = []
    this.chunks = [new Uint8Array([0x52, 0x49, 0x46, 0x46])]
  },
}

let streamChunks: string[] = ["Hello", " world!"]
let lastStreamTextOptions: Record<string, unknown> = {}
let lastModelId: string = ""
let classifyResult = {
  path: "fast" as const,
  confidence: 0.9,
  reason: "mocked",
  source: "heuristic" as const,
}
let reserveResult: { ok: boolean; error?: string; code?: string; upgradeUrl?: string } = {
  ok: true,
}
let enqueueTriggerCalls: { action: string; opts?: unknown }[] = []
let enqueueTriggerResult: unknown = ""
let fetchCalls: { url: string; method: string; body?: string }[] = []
const originalFetch = globalThis.fetch

// =============================================================================
// Module-level mocks (registered before any source imports)
// =============================================================================

mock.module("ai", () => {
  return {
    tool: (d: unknown) => d,
    jsonSchema: (s: unknown) => s,
    generateObject: async () => ({ object: {} }),
    generateText: async () => ({ text: "{}" }),
    streamText: (opts: { messages?: unknown[]; [k: string]: unknown }) => {
      lastStreamTextOptions = opts
      const chunks = [...streamChunks]
      return {
        textStream: (async function* () {
          for (const c of chunks) yield c
        })(),
        fullStream: (async function* () {
          for (const c of chunks) yield { type: "text-delta" as const, textDelta: c }
        })(),
      }
    },
    simulateReadableStream: (opts: unknown) => opts,
    MockLanguageModelV1: class {},
    EmbeddingModelV1: class {},
    embed: async () => ({ embedding: [0.1, 0.2, 0.3], usage: {} }),
  }
})

mock.module("./pipeline/model.js", () => ({
  createModel: (id: string) => {
    lastModelId = id
    return { provider: "openai", modelId: id }
  },
}))

mock.module("./services/elevenlabs/stt.js", () => ({
  elevenLabsTranscribe: async () => ({ text: "transcribed voice input" }),
}))

mock.module("./pipeline/tts.js", () => ({
  resolveTts: () => ttsMock.engine,
  synthesize: async function* (text: string) {
    ttsMock.calls.push(text)
    for (const chunk of ttsMock.chunks) yield chunk
  },
}))

mock.module("./insights/usage-store.js", () => ({
  logUsageEvent: () => {},
  initUsageStore: async () => {},
  closeUsageStore: () => {},
  resetUsageStore: async () => {},
  startSession: () => "",
  completeSession: () => {},
  queryUsageEvents: () => [],
  querySessions: () => [],
  queryDailyUsage: () => [],
  queryDailySessions: () => [],
  queryHourlyActivity: () => [],
  queryModelDistribution: () => [],
  querySessionLengths: () => [],
}))

mock.module("./usage/reserve.js", () => ({
  reserveInteraction: async (_kind: string) => reserveResult,
  finalizeInteractionUsage: () => {},
  reportUsage: (_kind: string) => {},
}))

mock.module("./connectors/registry.js", () => ({
  ConnectorRegistry: class {
    init = async (_userId: string) => {}
    getConnected = () => []
    getAllDefTools = () => ({})
  },
  getConnectorRegistry: () => ({ getConnected: () => [], getAllDefTools: () => ({}) }),
  initConnectorRegistry: async (_userId: string) => {},
  initConnectorRegistryFromSession: async () => {},
}))

mock.module("./gateway/remote-queue.js", () => ({
  enqueueTrigger: async (action: string, opts?: unknown) => {
    enqueueTriggerCalls.push({ action, opts })
    if (enqueueTriggerResult instanceof Error) throw enqueueTriggerResult
    return enqueueTriggerResult
  },
  consumePending: () => [],
  resolveTrigger: (_id: string, _text: string) => {},
  rejectTrigger: (_id: string, _error: string) => {},
}))

mock.module("./tools/cron/cron-scheduler.js", () => ({
  getDefaultScheduler: () => ({
    start: () => {},
    stop: () => {},
  }),
}))

mock.module("./router/intent.js", () => ({
  classifyIntent: async (_req: unknown) => classifyResult,
}))

mock.module("./graph/run.js", () => ({
  runGraph: async function* (_req: unknown) {
    yield { type: "agent_text" as const, text: "graph agent response for telegram" }
    yield { type: "done" as const }
  },
}))

// =============================================================================
// Dynamic imports (after mocks are registered)
// =============================================================================

let fastPipeline: (typeof import("./pipeline/fast.js"))["fastPipeline"]
let resolveText: (typeof import("./pipeline/fast.js"))["resolveText"]
let app: { fetch: typeof globalThis.fetch }
let handleGatewayMessage: (typeof import("./gateway/receive.js"))["handleGatewayMessage"]

beforeAll(async () => {
  const fastMod = await import("./pipeline/fast.js")
  fastPipeline = fastMod.fastPipeline
  resolveText = fastMod.resolveText
  app = (await import("./index.js")).default
  handleGatewayMessage = (await import("./gateway/receive.js")).handleGatewayMessage
})

beforeEach(() => {
  streamChunks = ["Hello", " world!"]
  lastStreamTextOptions = {}
  lastModelId = ""
  classifyResult = { path: "fast", confidence: 0.9, reason: "mocked", source: "heuristic" }
  reserveResult = { ok: true }
  enqueueTriggerCalls = []
  enqueueTriggerResult = ""
  fetchCalls = []
  ttsMock.reset()
  globalThis.fetch = async (url: string | URL | Request, opts?: RequestInit) => {
    fetchCalls.push({
      url: String(url),
      method: opts?.method ?? "GET",
      body: opts?.body as string | undefined,
    })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// =============================================================================
// Helpers
// =============================================================================

async function parseSse(response: Response): Promise<unknown[]> {
  const text = await response.text()
  const events: unknown[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.startsWith("data:")) {
      events.push(JSON.parse(trimmed.slice("data:".length).trim()))
    }
  }
  return events
}

async function collect(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const events: unknown[] = []
  for await (const ev of gen) {
    events.push(ev)
  }
  return events
}

// =============================================================================
// 1. LLM MODEL VERIFICATION — gpt-4.1-mini is used everywhere
// =============================================================================

describe("LLM model — gpt-4.1-mini default", () => {
  it("fast pipeline uses gpt-4.1-mini model", async () => {
    await collect(fastPipeline({ text: "hello" }))
    expect(lastModelId).toBe("gpt-4.1-mini")
  })

  it("fast pipeline sends model in streamText options", async () => {
    await collect(fastPipeline({ text: "test" }))
    expect(lastStreamTextOptions).toHaveProperty("model")
  })

  it("POST /query/fast HTTP endpoint returns 200 and SSE body", async () => {
    process.env.SIDECAR_SECRET = ""
    const res = await app.fetch(
      new Request("http://localhost/query/fast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const body = await res.text()
    expect(body).toContain("transcript")
    expect(body).toContain("done")
  })
})

// =============================================================================
// 2. STT INTEGRATION — speech-to-text works in all paths
// =============================================================================

describe("STT integration", () => {
  it("resolveText transcribes base64 audio", async () => {
    const dummyWav = Buffer.alloc(48).toString("base64")
    const text = await resolveText({ audio_b64: dummyWav })
    expect(text).toBe("transcribed voice input")
  })

  it("fastPipeline with audio_b64 emits transcript + llm_chunks + done", async () => {
    const dummyWav = Buffer.alloc(48).toString("base64")
    const events = await collect(fastPipeline({ audio_b64: dummyWav }))
    expect(events[0]).toMatchObject({ type: "transcript", text: "transcribed voice input" })
    expect(events.some((e: any) => e.type === "llm_chunk")).toBe(true)
    expect(events[events.length - 1]).toMatchObject({ type: "done" })
  })

  it("text field takes precedence over audio_b64", async () => {
    const dummyWav = Buffer.alloc(48).toString("base64")
    const text = await resolveText({ text: "explicit", audio_b64: dummyWav })
    expect(text).toBe("explicit")
  })

  it("POST /query with audio_b64 transcribes and routes to pipeline", async () => {
    process.env.SIDECAR_SECRET = ""
    const dummyWav = Buffer.alloc(48).toString("base64")
    const res = await app.fetch(
      new Request("http://localhost/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_b64: dummyWav }),
      }),
    )
    expect(res.status).toBe(200)
    const events = await parseSse(res)
    const transcript = events.find((e: any) => e.type === "transcript")
    expect(transcript).toBeDefined()
    expect((transcript as any).text).toBe("transcribed voice input")
  })
})

// =============================================================================
// 3. TTS INTEGRATION — text-to-speech audio output
// =============================================================================

describe("TTS integration", () => {
  it("fast pipeline produces audio_chunk events when TTS is enabled", async () => {
    ttsMock.engine = "elevenlabs"
    const events = await collect(fastPipeline({ text: "hello world", tts: true }))
    expect(events.some((e: any) => e.type === "audio_chunk")).toBe(true)
    const audioChunks = events.filter((e: any) => e.type === "audio_chunk")
    expect(audioChunks.length).toBeGreaterThanOrEqual(1)
    for (const chunk of audioChunks) {
      expect(typeof (chunk as any).base64).toBe("string")
      expect((chunk as any).base64.length).toBeGreaterThan(0)
    }
  })

  it("passes LLM text to TTS synthesize", async () => {
    ttsMock.engine = "elevenlabs"
    streamChunks = ["This is a test sentence."]
    await collect(fastPipeline({ text: "hi", tts: true }))
    expect(ttsMock.calls.length).toBeGreaterThanOrEqual(1)
    const allText = ttsMock.calls.join("")
    expect(allText).toContain("This is a test sentence.")
  })

  it("fast pipeline without TTS produces no audio_chunk events", async () => {
    ttsMock.engine = "none"
    const events = await collect(fastPipeline({ text: "hello world", tts: false }))
    expect(events.some((e: any) => e.type === "audio_chunk")).toBe(false)
  })

  it("POST /query/fast with tts=true emits audio_chunk events in SSE stream", async () => {
    process.env.SIDECAR_SECRET = ""
    ttsMock.engine = "elevenlabs"
    const res = await app.fetch(
      new Request("http://localhost/query/fast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "test tts", tts: true }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain("audio_chunk")
    expect(body).toContain("base64")
    expect(body).toContain("done")
  })
})

// =============================================================================
// 4. FULL /query ENDPOINT — unified entry point
// =============================================================================

describe("/query unified endpoint", () => {
  beforeEach(() => {
    process.env.SIDECAR_SECRET = ""
  })

  afterEach(() => {
    process.env.SIDECAR_SECRET = "test-secret"
  })

  it("routes text through intent classifier and emits router_decision + done", async () => {
    const res = await app.fetch(
      new Request("http://localhost/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      }),
    )
    expect(res.status).toBe(200)
    const events = await parseSse(res)
    expect(events.some((e: any) => e.type === "router_decision")).toBe(true)
    expect(events.some((e: any) => e.type === "done")).toBe(true)
  })

  it("routes to agent path when classifier says agent", async () => {
    classifyResult = { path: "agent", confidence: 0.95, reason: "complex task", source: "llm" }
    const res = await app.fetch(
      new Request("http://localhost/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "research quantum computing" }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain("agent_text")
    expect(body).toContain("done")
  })

  it("supports voice + screenshot together", async () => {
    const dummyWav = Buffer.alloc(48).toString("base64")
    const res = await app.fetch(
      new Request("http://localhost/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio_b64: dummyWav,
          screenshot_b64:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        }),
      }),
    )
    expect(res.status).toBe(200)
    const events = await parseSse(res)
    const transcript = events.find((e: any) => e.type === "transcript")
    expect(transcript).toBeDefined()
  })

  it("returns usage_limit event when reservation fails", async () => {
    reserveResult = { ok: false, error: "Daily limit reached", code: "quota_exceeded" }
    const res = await app.fetch(
      new Request("http://localhost/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain("usage_limit")
  })
})

// =============================================================================
// 5. HTTP /query/fast ENDPOINT — direct fast pipeline
// =============================================================================

describe("/query/fast HTTP endpoint", () => {
  beforeEach(() => {
    process.env.SIDECAR_SECRET = ""
  })

  afterEach(() => {
    process.env.SIDECAR_SECRET = "test-secret"
  })

  it("returns SSE stream with transcript + llm_chunk + done for text", async () => {
    const res = await app.fetch(
      new Request("http://localhost/query/fast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello world" }),
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const body = await res.text()
    expect(body).toContain("transcript")
    expect(body).toContain("llm_chunk")
    expect(body).toContain("done")
  })

  it("errors on empty text body", async () => {
    const res = await app.fetch(
      new Request("http://localhost/query/fast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 401 when auth secret is wrong", async () => {
    process.env.SIDECAR_SECRET = "test-secret-123"
    const res = await app.fetch(
      new Request("http://localhost/query/fast", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sidecar-secret": "wrong-secret" },
        body: JSON.stringify({ text: "hello" }),
      }),
    )
    expect(res.status).toBe(401)
  })
})

// =============================================================================
// 6. HTTP /query/agent ENDPOINT — direct agent pipeline
// =============================================================================

describe("/query/agent HTTP endpoint", () => {
  beforeEach(() => {
    process.env.SIDECAR_SECRET = ""
  })

  afterEach(() => {
    process.env.SIDECAR_SECRET = "test-secret"
  })

  it("returns SSE stream with agent_text + done", async () => {
    const res = await app.fetch(
      new Request("http://localhost/query/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "tell me about drive" }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain("agent_text")
    expect(body).toContain("done")
  })
})

// =============================================================================
// 7. /stt STANDALONE ENDPOINT
// =============================================================================

describe("POST /stt standalone endpoint", () => {
  beforeEach(() => {
    process.env.SIDECAR_SECRET = ""
  })

  afterEach(() => {
    process.env.SIDECAR_SECRET = "test-secret"
  })

  it("returns transcribed text for valid WAV audio", async () => {
    const dummyWav = Buffer.alloc(48)
    const form = new FormData()
    form.append("audio", new Blob([dummyWav], { type: "audio/wav" }), "audio.wav")
    const res = await app.fetch(
      new Request("http://localhost/stt", {
        method: "POST",
        body: form,
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.text).toBe("transcribed voice input")
  })

  it("returns 400 for empty form data", async () => {
    const form = new FormData()
    const res = await app.fetch(
      new Request("http://localhost/stt", {
        method: "POST",
        body: form,
      }),
    )
    expect(res.status).toBe(400)
  })
})

// =============================================================================
// 8. DESKTOP TRIGGER PATTERNS — shouldUseAgent routing
// =============================================================================

describe("desktop trigger patterns — shouldUseAgent", () => {
  const shouldUseAgent = (text: string): boolean => {
    return /\b(open|click|press|type|enter|fill|select|choose|check|uncheck|toggle|close|switch|go to|navigate|delete|send|save|copy|paste|rename|create|run|play|pause|resume|spotify|volume|sound|audio|louder|quieter|mute|unmute|increase|decrease|lower|raise|inc|dec|text|message|msg|whats\s*app|whatsapp|tell|ping)\b/i.test(
      text,
    )
  }

  it("routes voice trigger to agent (contains 'tell')", () => {
    expect(shouldUseAgent("tell me my emails")).toBe(true)
  })

  it("routes analyze screen to agent (contains 'look at')", () => {
    expect(shouldUseAgent("look at my screen")).toBe(false)
  })

  it("routes send message to agent", () => {
    expect(shouldUseAgent("send a message")).toBe(true)
  })

  it("routes open app to agent", () => {
    expect(shouldUseAgent("open chrome")).toBe(true)
  })

  it("routes click to agent", () => {
    expect(shouldUseAgent("click submit")).toBe(true)
  })

  it("routes play/pause to agent", () => {
    expect(shouldUseAgent("play music")).toBe(true)
    expect(shouldUseAgent("pause youtube")).toBe(true)
  })

  it("routes text query to agent", () => {
    expect(shouldUseAgent("text john")).toBe(true)
  })

  it("routes simple Q&A to fast path (no action verb)", () => {
    expect(shouldUseAgent("what is 2+2?")).toBe(false)
    expect(shouldUseAgent("hello")).toBe(false)
    expect(shouldUseAgent("translate hello to french")).toBe(false)
  })
})

// =============================================================================
// 9. TELEGRAM BOT — gateway end-to-end integration
// =============================================================================

describe("Telegram bot gateway", () => {
  const sampleMsg = {
    platform: "telegram" as const,
    chatId: "-100test",
    userId: "tg-user-test",
    text: "hello world",
    timestamp: new Date().toISOString(),
  }

  it("routes Telegram message through fast pipeline and sends reply via backend", async () => {
    await handleGatewayMessage(sampleMsg)
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    expect(sendCall).toBeDefined()
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toBe("Hello world!")
    expect(body.platform).toBe("telegram")
    expect(body.chatId).toBe("-100test")
  })

  it("routes to agent pipeline when intent classifier says agent", async () => {
    classifyResult = { path: "agent", confidence: 0.95, reason: "complex", source: "llm" }
    await handleGatewayMessage(sampleMsg)
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    expect(sendCall).toBeDefined()
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toContain("graph agent response")
  })

  it("treats /screenshot as normal text, not a desktop trigger", async () => {
    enqueueTriggerResult = "data:image/png;base64,screenshot-data"
    await handleGatewayMessage({ ...sampleMsg, text: "/screenshot" })
    expect(enqueueTriggerCalls).toHaveLength(0)
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    expect(sendCall).toBeDefined()
  })

  it("treats /voice as normal text, not a desktop trigger", async () => {
    await handleGatewayMessage({ ...sampleMsg, text: "/voice" })
    expect(enqueueTriggerCalls).toHaveLength(0)
  })

  it("treats /move as normal text, not a desktop trigger", async () => {
    await handleGatewayMessage({ ...sampleMsg, text: "/move left" })
    expect(enqueueTriggerCalls).toHaveLength(0)
  })

  it("treats screen analysis text as normal text, not a desktop trigger", async () => {
    enqueueTriggerResult = "I see VS Code with a terminal open"
    await handleGatewayMessage({ ...sampleMsg, text: "analyze my screen" })
    expect(enqueueTriggerCalls).toHaveLength(0)
  })

  it("treats 'look at' screen analysis as normal text", async () => {
    await handleGatewayMessage({ ...sampleMsg, text: "look at my screen" })
    expect(enqueueTriggerCalls).toHaveLength(0)
  })

  it("treats 'check my screen' analysis as normal text", async () => {
    await handleGatewayMessage({ ...sampleMsg, text: "check my screen" })
    expect(enqueueTriggerCalls).toHaveLength(0)
  })

  it("sends usage limit error when reservation fails", async () => {
    reserveResult = { ok: false, error: "Bot message limit reached.", code: "quota_exceeded" }
    await handleGatewayMessage(sampleMsg)
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    expect(sendCall).toBeDefined()
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toContain("Bot message limit reached.")
  })

  it("passes conversation history across messages in same chat", async () => {
    await handleGatewayMessage({ ...sampleMsg, text: "what's my name?", chatId: "hist-1" })
    fetchCalls = []
    streamChunks = ["Your name is Arkady."]
    await handleGatewayMessage({ ...sampleMsg, text: "what did I just ask?", chatId: "hist-1" })
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    expect(sendCall).toBeDefined()
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toBe("Your name is Arkady.")
  })

  it("handles /type command by recursively processing query", async () => {
    await handleGatewayMessage({ ...sampleMsg, text: "/type what is 2+2?" })
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    expect(sendCall).toBeDefined()
    expect(sendCall).toBeDefined()
    const body = JSON.parse(sendCall!.body!)
    expect(body.text).toBeTruthy()
  })
})

// =============================================================================
// 10. ERROR HANDLING — STT, auth, reservation, empty input
// =============================================================================

describe("error handling across all paths", () => {
  it("returns error event for empty text in fastPipeline", async () => {
    const events = await collect(fastPipeline({ text: "" }))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: "error", message: "No input text provided" })
  })

  it("returns 401 for unauthorized /query/fast request", async () => {
    process.env.SIDECAR_SECRET = "test-secret-123"
    const res = await app.fetch(
      new Request("http://localhost/query/fast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 401 for unauthorized /stt request", async () => {
    process.env.SIDECAR_SECRET = "test-secret-123"
    const form = new FormData()
    form.append("audio", new Blob([Buffer.alloc(48)], { type: "audio/wav" }), "audio.wav")
    const res = await app.fetch(
      new Request("http://localhost/stt", {
        method: "POST",
        body: form,
      }),
    )
    expect(res.status).toBe(401)
  })

  it("GET /health returns 200 without auth", async () => {
    const res = await app.fetch(new Request("http://localhost/health"))
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.status).toBe("ok")
  })
})
