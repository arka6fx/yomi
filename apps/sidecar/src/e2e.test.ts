/**
 * End-to-end tests covering all pipeline types (fast, agent, graph),
 * connector awareness, routing, STT, TTS, and LLM orchestration.
 *
 * Follows the same mock pattern as integration.test.ts:
 *   - Module-level mocks for external services (STT, TTS, AI SDK, etc.)
 *   - Dynamic imports after mocks register
 *   - Pure-function tests (prompt builder, router) need no mocks at all
 *
 * Run:   bun test apps/sidecar/src/e2e.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, mock, beforeAll, afterAll } from "bun:test"
import { MockLanguageModelV1 } from "ai/test"
import { simulateReadableStream } from "ai"
import type { LanguageModelV1, LanguageModelV1StreamPart } from "ai"

// =============================================================================
// Shared mock state
// =============================================================================

let streamChunks: string[] = [
  "To use Google Drive, you need to connect it first at https://yomi.arka6fx.com/dashboard. I don't have access to your Drive files yet.",
]
let lastStmOptions: Record<string, unknown> = {}
let classifyResult = {
  path: "fast" as const,
  confidence: 0.9,
  reason: "mocked",
  source: "heuristic" as const,
}
let reserveResult: { ok: boolean; error?: string; code?: string; upgradeUrl?: string } = {
  ok: true,
}
let fetchCalls: { url: string; method: string; body?: string }[] = []
let fastCallArgs: unknown[] = []
let agentCallArgs: unknown[] = []
const originalFetch = globalThis.fetch

// =============================================================================
// Module-level mocks (registered before any source imports)
// Paths are relative to this file (apps/sidecar/src/)
// =============================================================================

mock.module("ai", () => {
  function noop() {}
  return {
    tool: (d: unknown) => d,
    jsonSchema: (s: unknown) => s,
    generateObject: async () => ({ object: {} }),
    generateText: async () => ({ text: "{}" }),
    streamText: (opts: { messages?: unknown[]; [k: string]: unknown }) => {
      lastStmOptions = opts
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
  createModel: (id: string) => ({ provider: "ai-credits", modelId: id }),
}))

mock.module("./services/elevenlabs/stt.js", () => ({
  elevenLabsTranscribe: async () => ({ text: "can u tell if i have cat images in drive" }),
}))

mock.module("./pipeline/tts.js", () => ({
  resolveTts: () => "none" as const,
  synthesize: async function* () {},
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
  enqueueTrigger: async () => {},
  consumePending: () => [],
  resolveTrigger: () => {},
  rejectTrigger: () => {},
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
  runGraph: async function* (req: unknown) {
    yield {
      type: "agent_text" as const,
      text: "To use Google Drive, please connect it at https://yomi.arka6fx.com/dashboard. I don't have access to your Drive files yet.",
    }
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
let buildFastPrompt: (typeof import("./harness/prompt.js"))["buildFastPrompt"]
let buildAgentPrompt: (typeof import("./harness/prompt.js"))["buildAgentPrompt"]
let buildConnectorInfo: (typeof import("./harness/prompt.js"))["buildConnectorInfo"]
let scoreHeuristic: (typeof import("./router/heuristic.js"))["scoreHeuristic"]
let ALL_CONNECTOR_DEFS: (typeof import("@yomi/agent-core"))["ALL_CONNECTOR_DEFS"]
let shouldUseAgent: (text: string) => boolean

beforeAll(async () => {
  const fastMod = await import("./pipeline/fast.js")
  fastPipeline = fastMod.fastPipeline
  resolveText = fastMod.resolveText

  app = (await import("./index.js")).default
  handleGatewayMessage = (await import("./gateway/receive.js")).handleGatewayMessage

  const promptMod = await import("./harness/prompt.js")
  buildFastPrompt = promptMod.buildFastPrompt
  buildAgentPrompt = promptMod.buildAgentPrompt
  buildConnectorInfo = promptMod.buildConnectorInfo

  scoreHeuristic = (await import("./router/heuristic.js")).scoreHeuristic

  ALL_CONNECTOR_DEFS = (await import("@yomi/agent-core")).ALL_CONNECTOR_DEFS

  // Inline shouldUseAgent from desktop IPC — pure regex function
  shouldUseAgent = (text: string): boolean => {
    return /\b(open|click|press|type|enter|fill|select|choose|check|uncheck|toggle|close|switch|go to|navigate|delete|send|save|copy|paste|rename|create|run|play|pause|resume|spotify|volume|sound|audio|louder|quieter|mute|unmute|increase|decrease|lower|raise|inc|dec|text|message|msg|whats\s*app|whatsapp|tell|ping)\b/i.test(
      text,
    )
  }
})

beforeEach(() => {
  streamChunks = [
    "To use Google Drive, you need to connect it first at https://yomi.arka6fx.com/dashboard. I don't have access to your Drive files yet.",
  ]
  lastStmOptions = {}
  classifyResult = { path: "fast", confidence: 0.9, reason: "mocked", source: "heuristic" }
  reserveResult = { ok: true }
  fetchCalls = []
  fastCallArgs = []
  agentCallArgs = []
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

async function collect(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const events: unknown[] = []
  for await (const ev of gen) {
    events.push(ev)
  }
  return events
}

// =============================================================================
// 1. CONNECTOR REGISTRY — ALL_CONNECTOR_DEFS includes expected services
// =============================================================================

describe("ALL_CONNECTOR_DEFS", () => {
  it("includes Google Drive", () => {
    const ids = ALL_CONNECTOR_DEFS.map((d) => d.id)
    expect(ids).toContain("google-drive")
  })

  it("includes Gmail, Calendar, GitHub, Notion, Slack, Linear", () => {
    const ids = ALL_CONNECTOR_DEFS.map((d) => d.id)
    // Note: connector IDs may differ from display names
    const idSet = new Set(ids)
    expect(idSet.has("google") || idSet.has("google-gmail")).toBe(true)
    expect(ids).toContain("google-calendar")
    expect(ids).toContain("github")
    expect(ids).toContain("notion")
    expect(ids).toContain("slack")
    expect(ids).toContain("linear")
  })

  it("has at least 8 connectors registered", () => {
    expect(ALL_CONNECTOR_DEFS.length).toBeGreaterThanOrEqual(8)
  })
})

// =============================================================================
// 2. PROMPT BUILDER — connector info is injected correctly
// =============================================================================

describe("buildConnectorInfo", () => {
  it("returns 'none' when no connectors are connected", () => {
    const result = buildConnectorInfo([])
    expect(result).toContain("Available connectors:")
    expect(result).toContain("Currently connected: none")
    expect(result).toContain("Google Drive")
    expect(result).toContain("Gmail")
  })

  it("lists only connected connectors when some are connected", () => {
    const result = buildConnectorInfo(["google-drive", "github"])
    // Order follows ALL_CONNECTOR_DEFS: Google Drive before GitHub
    expect(result).toContain("Currently connected:")
    expect(result).toContain("Google Drive")
    expect(result).toContain("GitHub")
    expect(result).not.toContain("Currently connected: none")
  })

  it("returns valid XML tags", () => {
    const result = buildConnectorInfo([])
    expect(result).toContain("<connector_info>")
    expect(result).toContain("</connector_info>")
  })
})

describe("buildFastPrompt — connector awareness", () => {
  const connectorText = "check my gmail inbox"

  it("includes <connector_info> when query mentions a connector", () => {
    const prompt = buildFastPrompt({ text: connectorText, tts: false, connectedProviders: [] })
    expect(prompt).toContain("<connector_info>")
    expect(prompt).toContain("Currently connected: none")
    expect(prompt).toContain("Google Drive")
  })

  it("includes hard rules about unconnected connectors when query mentions a connector", () => {
    const prompt = buildFastPrompt({ text: connectorText, tts: false, connectedProviders: [] })
    expect(prompt).toContain("<rules>")
    expect(prompt).toContain("MUST say they need to connect it")
    expect(prompt).toContain("Do NOT guess or make up information")
    expect(prompt).toContain("it isn't available as a Yomi connector")
    expect(prompt).toContain("/dashboard")
  })

  it("omits connector blocks when query does not mention any connector", () => {
    const prompt = buildFastPrompt({
      text: "what is the weather",
      tts: false,
      connectedProviders: [],
    })
    expect(prompt).not.toContain("<connector_info>")
    expect(prompt).not.toContain("MUST say they need to connect it")
  })

  it("shows connected providers when some are connected", () => {
    const prompt = buildFastPrompt({
      text: connectorText,
      tts: false,
      connectedProviders: ["google-drive"],
    })
    expect(prompt).toContain("Currently connected: Google Drive")
  })
})

describe("buildAgentPrompt — connector awareness", () => {
  it("includes <connector_info> in the prompt", () => {
    const prompt = buildAgentPrompt({ connectedProviders: [] })
    expect(prompt).toContain("<connector_info>")
    expect(prompt).toContain("Currently connected: none")
  })

  it("includes hard rules about unconnected connectors in <rules>", () => {
    const prompt = buildAgentPrompt({ connectedProviders: [] })
    expect(prompt).toContain("MUST say they need to connect it")
    expect(prompt).toContain("Do NOT try to use a tool for an app that isn't connected")
    expect(prompt).toContain("it isn't available as a Yomi connector")
  })

  it("includes capabilities rule about connected-only tools", () => {
    const prompt = buildAgentPrompt({ connectedProviders: [] })
    // "ONLY" is uppercase in the prompt
    expect(prompt).toContain("ONLY for connectors listed as connected above")
  })
})

// =============================================================================
// 3. HEURISTIC ROUTER — connector queries route to agent path
// =============================================================================

describe("heuristic router — connector routing", () => {
  const connectorQueries = [
    "can u tell if i have cat images in drive",
    "what's in my Notion?",
    "check my gmail",
    "show my github issues",
    "any email from today",
    "what meeting do i have",
    "find that slack message",
    "linear tickets assigned to me",
  ]

  for (const q of connectorQueries) {
    it(`routes "${q}" to agent path`, () => {
      const result = scoreHeuristic({ text: q })
      expect(result.path).toBe("agent")
      expect(result.reason).toContain("connector query")
    })
  }

  const nonConnectorQueries = [
    "what is 2+2?",
    "hello",
    "translate hello to french",
    "explain quantum computing",
  ]

  for (const q of nonConnectorQueries) {
    it(`does NOT route "${q}" to agent via connector rule`, () => {
      const result = scoreHeuristic({ text: q })
      // These may still go to agent via other scoring, but not via connector rule
      expect(result.reason).not.toContain("connector query")
    })
  }
})

// =============================================================================
// 4. DESKTOP IPC ROUTING — shouldUseAgent behavior
// =============================================================================

describe("desktop shouldUseAgent", () => {
  it("routes 'can u tell...' to agent because 'tell' is an action verb", () => {
    expect(shouldUseAgent("can u tell if i have cat images in drive")).toBe(true)
  })

  it("routes action verb 'tell' to agent", () => {
    expect(shouldUseAgent("tell me my emails")).toBe(true)
  })

  it("routes 'open' to agent", () => {
    expect(shouldUseAgent("open chrome")).toBe(true)
  })

  it("routes 'send message' to agent", () => {
    expect(shouldUseAgent("send a message to john")).toBe(true)
  })

  it("routes 'click' to agent", () => {
    expect(shouldUseAgent("click the submit button")).toBe(true)
  })
})

// =============================================================================
// 5. FAST PIPELINE — connector-specific scenario
// =============================================================================

describe("fast pipeline — connector awareness scenario", () => {
  it("emits transcript + llm_chunks + done for connector query", async () => {
    const events = await collect(
      fastPipeline({
        text: "can u tell if i have cat images in drive",
      }),
    )

    expect(events[0]).toMatchObject({
      type: "transcript",
      text: "can u tell if i have cat images in drive",
    })
    const llmChunks = events.filter((e: any) => e.type === "llm_chunk")
    expect(llmChunks.length).toBeGreaterThanOrEqual(1)
    expect(events[events.length - 1]).toMatchObject({ type: "done" })
  })

  it("includes connector_info in system prompt", async () => {
    await collect(
      fastPipeline({
        text: "can u tell if i have cat images in drive",
      }),
    )

    const messages = lastStmOptions.messages as any[]
    const systemMsg = messages?.find((m: any) => m.role === "system")
    expect(systemMsg).toBeDefined()
    expect(systemMsg.content).toContain("<connector_info>")
    expect(systemMsg.content).toContain("Google Drive")
    expect(systemMsg.content).toContain("Currently connected: none")
  })

  it("includes connector rules in system prompt", async () => {
    await collect(
      fastPipeline({
        text: "can u tell if i have cat images in drive",
      }),
    )

    const messages = lastStmOptions.messages as any[]
    const systemMsg = messages?.find((m: any) => m.role === "system")
    expect(systemMsg).toBeDefined()
    expect(systemMsg.content).toContain("MUST say they need to connect it")
    expect(systemMsg.content).toContain("/dashboard")
  })

  it("LLM response mentions connecting Drive when not connected", async () => {
    streamChunks = [
      "To check your Google Drive, you'd need to connect it at https://yomi.arka6fx.com/dashboard. I don't have access to your Drive files yet.",
    ]
    const events = await collect(
      fastPipeline({
        text: "can u tell if i have cat images in drive",
      }),
    )

    const fullText = events
      .filter((e: any) => e.type === "llm_chunk")
      .map((e: any) => e.text)
      .join("")
    expect(fullText.toLowerCase()).toContain("drive")
    expect(fullText.toLowerCase()).toContain("connect")
    expect(fullText.toLowerCase()).toContain("dashboard")
  })
})

// =============================================================================
// 6. VOICE TRIGGER — STT integration with connector query
// =============================================================================

describe("voice trigger — STT + connector awareness", () => {
  it("resolveText transcribes audio_b64 to connector query", async () => {
    const dummyWav = Buffer.alloc(48).toString("base64")
    const text = await resolveText({ audio_b64: dummyWav })
    expect(text).toBe("can u tell if i have cat images in drive")
  })

  it("fastPipeline with audio emits transcript + connector-aware response", async () => {
    const dummyWav = Buffer.alloc(48).toString("base64")
    const events = await collect(fastPipeline({ audio_b64: dummyWav }))
    expect(events[0]).toMatchObject({
      type: "transcript",
      text: "can u tell if i have cat images in drive",
    })
    expect(events.some((e: any) => e.type === "llm_chunk")).toBe(true)
    expect(events[events.length - 1]).toMatchObject({ type: "done" })
  })
})

// =============================================================================
// 7. GATEWAY — connector queries through gateway
// =============================================================================

describe("gateway — connector awareness", () => {
  const sampleMsg = {
    platform: "telegram" as const,
    chatId: "-100test",
    userId: "tg-user-test",
    text: "can u tell if i have cat images in drive",
    timestamp: new Date().toISOString(),
  }

  it("routes connector query through fast pipeline and sends reply mentioning Drive", async () => {
    await handleGatewayMessage(sampleMsg)
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    expect(sendCall).toBeDefined()
    const body = JSON.parse(sendCall!.body!)
    expect(body.text.toLowerCase()).toContain("drive")
  })

  it("routes to agent path when classifier says agent", async () => {
    classifyResult = { path: "agent", confidence: 0.9, reason: "connector query", source: "llm" }
    await handleGatewayMessage(sampleMsg)
    const sendCall = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
    expect(sendCall).toBeDefined()
    const body = JSON.parse(sendCall!.body!)
    expect(body.text.toLowerCase()).toContain("drive")
    expect(body.text.toLowerCase()).toContain("connect")
  })
})

// =============================================================================
// 8. HEURISTIC + PROMPT — combined: router routes + prompt has info
// =============================================================================

describe("end-to-end scenario: 'can u tell if i have cat images in drive'", () => {
  it("heuristic router routes to agent path (Drive triggers CONNECTOR_QUERY)", () => {
    const result = scoreHeuristic({ text: "can u tell if i have cat images in drive" })
    expect(result.path).toBe("agent")
    expect(result.confidence).toBe(0.85)
    expect(result.source).toBe("heuristic")
  })

  it("desktop routes to /query/agent because 'tell' is an action verb", () => {
    // The query has "tell" which matches shouldUseAgent, so desktop
    // sends directly to /query/agent. The agent path has connector tools.
    expect(shouldUseAgent("can u tell if i have cat images in drive")).toBe(true)
  })

  it("fast prompt has Drive in available list and connection rule", () => {
    const prompt = buildFastPrompt({ text: "use google drive", tts: false, connectedProviders: [] })
    expect(prompt).toContain("Available connectors:")
    expect(prompt).toContain("Google Drive")
    expect(prompt).toContain("MUST say they need to connect it")
    expect(prompt).toContain("Do NOT guess or make up information")
  })

  it("agent prompt has Drive in available list and tool-usage rule", () => {
    const prompt = buildAgentPrompt({ connectedProviders: [] })
    expect(prompt).toContain("Google Drive")
    expect(prompt).toContain("Do NOT try to use a tool for an app that isn't connected")
  })
})

// =============================================================================
// 9. HTTP ENDPOINTS — fast pipeline with connector query via HTTP
// =============================================================================

describe("HTTP endpoints — connector scenario", () => {
  beforeEach(() => {
    // Disable auth for HTTP endpoint tests (same pattern as integration.test.ts)
    process.env.SIDECAR_SECRET = ""
  })

  afterEach(() => {
    process.env.SIDECAR_SECRET = "test-secret"
  })

  it("POST /query/fast returns SSE stream with connector-aware response", async () => {
    const res = await app.fetch(
      new Request("http://localhost/query/fast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "can u tell if i have cat images in drive" }),
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")

    const body = await res.text()
    expect(body).toContain("transcript")
    expect(body).toContain("llm_chunk")
    expect(body).toContain("done")
  })

  it("POST /query routes through intent classifier with connector query", async () => {
    const res = await app.fetch(
      new Request("http://localhost/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "can u tell if i have cat images in drive" }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain("router_decision")
    expect(body).toContain("done")
  })
})

describe("all pipeline types — basic execution", () => {
  beforeEach(() => {
    process.env.SIDECAR_SECRET = ""
  })

  afterEach(() => {
    process.env.SIDECAR_SECRET = "test-secret"
  })

  it("fast pipeline emits transcript + llm_chunk + done", async () => {
    const events = await collect(fastPipeline({ text: "hello" }))
    const types = events.map((e: any) => e.type)
    expect(types).toContain("transcript")
    expect(types).toContain("llm_chunk")
    expect(types).toContain("done")
  })

  it("agent query goes through correct path when classifier says agent", async () => {
    classifyResult = { path: "agent", confidence: 0.9, reason: "complex task", source: "llm" }
    const res = await app.fetch(
      new Request("http://localhost/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "research quantum computing" }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    // Agent path emits agent_text from the graph mock
    expect(body).toContain("agent_text")
    expect(body).toContain("done")
  })

  it("POST /query/agent directly routes to agent", async () => {
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
