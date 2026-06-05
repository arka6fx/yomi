import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { streamSSE } from "hono/streaming"
import type { AgentQueryRequest, FastQueryRequest, SseEvent } from "@yomi/shared"
import { fastPipeline, resolveText } from "./pipeline/fast.js"
import { agentPipeline } from "./pipeline/agent.js"
import { transcribe } from "./stt.js"
import { ElevenLabsSttError } from "./services/elevenlabs/stt.js"
import { classifyIntent } from "./router/intent.js"
import { initMemorySubsystem } from "./memory/subsystem.js"
import { resolveConfirmation } from "./uia/act-bus.js"
import { closeMcp } from "./mcp/client.js"
import { duckSpotify } from "./tools/system.js"
import { getReplayCommand, listWorkflowReplays } from "./automation/runs.js"
import { allProviders, getProvider } from "./automation/providers/registry.js"
import type { ProviderId } from "./automation/providers/types.js"
import { resolveAgent } from "./automation/agents/registry.js"
import { knowledgeHint, recallKnowledge } from "./automation/knowledge.js"

// Ensure ~/.yomi/ directory tree exists before serving any requests.
initMemorySubsystem().catch((err) => console.warn("[yomi] memory subsystem init failed:", err))

const app = new Hono()

const VERSION = "0.1.0"

// The agent path runs through the LangGraph orchestrator by default. Set YOMI_LEGACY_AGENT=1 to
// fall back to the original AI-SDK ReAct loop (keeps the WhatsApp/Spotify/Notepad shortcuts).
// runGraph is lazily imported so the fast/chat path never loads LangChain.
type AgentDriver = (
  req: AgentQueryRequest,
  opts?: { emit?: (e: SseEvent) => void; signal?: AbortSignal },
) => AsyncGenerator<SseEvent>

async function getAgentDriver(): Promise<AgentDriver> {
  if (process.env.YOMI_LEGACY_AGENT === "1") return agentPipeline as AgentDriver
  const { runGraph } = await import("./graph/run.js")
  return runGraph as AgentDriver
}

const authMiddleware: MiddlewareHandler = async (c, next) => {
  // Read lazily so tests can manipulate the env var at runtime
  const secret = process.env.SIDECAR_SECRET
  const header = c.req.header("x-sidecar-secret")
  if (secret && header !== secret) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  await next()
}

app.use("/query", authMiddleware)
app.use("/query/*", authMiddleware)
app.use("/stt", authMiddleware)
app.use("/act/*", authMiddleware)
app.use("/automation/*", authMiddleware)
app.use("/spotify/*", authMiddleware)

app.get("/health", (c) => {
  return c.json({ status: "ok", version: VERSION })
})

// Unified entry point: classifies intent then routes to the appropriate pipeline.
app.post("/query", async (c) => {
  let body: FastQueryRequest
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400)
  }

  return streamSSE(c, async (stream) => {
    // Normalise input once so neither the router nor the pipeline pays twice for STT
    let text: string | undefined
    try {
      text = (await resolveText(body)) ?? undefined
    } catch (err) {
      const message = err instanceof Error ? err.message : "STT failed"
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message } satisfies SseEvent) })
      return
    }

    if (!text) {
      await stream.writeSSE({
        data: JSON.stringify({
          type: "error",
          message: "text or audio_b64 field is required",
        } satisfies SseEvent),
      })
      return
    }

    const decision = await classifyIntent({
      text,
      screenshot_b64: body.screenshot_b64,
      history: body.history,
    })
    await stream.writeSSE({
      data: JSON.stringify({
        type: "router_decision",
        path: decision.path,
        confidence: decision.confidence,
        reason: decision.reason,
        source: decision.source,
      } satisfies SseEvent),
    })

    if (decision.path === "agent") {
      const agentReq: AgentQueryRequest = {
        text,
        screenshot_b64: body.screenshot_b64,
        plan: body.plan,
      }
      const emit = (e: SseEvent) => {
        void stream.writeSSE({ data: JSON.stringify(e) })
      }
      try {
        const driver = await getAgentDriver()
        for await (const event of driver(agentReq, { emit, signal: c.req.raw.signal })) {
          await stream.writeSSE({ data: JSON.stringify(event) })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error"
        await stream.writeSSE({
          data: JSON.stringify({ type: "error", message } satisfies SseEvent),
        })
      }
    } else {
      const normalised: FastQueryRequest = { ...body, text }
      try {
        for await (const event of fastPipeline(normalised, c.req.raw.signal)) {
          await stream.writeSSE({ data: JSON.stringify(event) })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error"
        await stream.writeSSE({
          data: JSON.stringify({ type: "error", message } satisfies SseEvent),
        })
      }
    }
  })
})

app.post("/query/fast", async (c) => {
  let body: FastQueryRequest
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400)
  }

  if (!body.text?.trim() && !body.audio_b64) {
    return c.json({ error: "text or audio_b64 field is required" }, 400)
  }

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of fastPipeline(body, c.req.raw.signal)) {
        await stream.writeSSE({ data: JSON.stringify(event) })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error"
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message } satisfies SseEvent) })
    }
  })
})

// Direct override route — bypasses intent classification. Useful for tests and dev tools.
app.post("/query/agent", async (c) => {
  let body: AgentQueryRequest
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400)
  }
  if (!body.text?.trim()) return c.json({ error: "text field is required" }, 400)

  return streamSSE(c, async (stream) => {
    const emit = (e: SseEvent) => {
      void stream.writeSSE({ data: JSON.stringify(e) })
    }
    try {
      const driver = await getAgentDriver()
      for await (const event of driver(body, { emit, signal: c.req.raw.signal })) {
        await stream.writeSSE({ data: JSON.stringify(event) })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error"
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message } satisfies SseEvent) })
    }
  })
})

// Act-mode confirmation callback (Spec 16): desktop posts the user's yes/no for a risky action.
app.post("/act/confirm", async (c) => {
  let body: { id?: string; approved?: boolean }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400)
  }
  if (!body.id) return c.json({ error: "id required" }, 400)
  const resolved = resolveConfirmation(body.id, body.approved === true)
  return c.json({ ok: resolved })
})

app.post("/automation/replay", async (c) => {
  let body: { replayId?: string; plan?: AgentQueryRequest["plan"] }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400)
  }
  if (!body.replayId) return c.json({ error: "replayId required" }, 400)
  const text = getReplayCommand(body.replayId)
  if (!text) return c.json({ error: "replay not found" }, 404)

  return streamSSE(c, async (stream) => {
    const emit = (e: SseEvent) => {
      void stream.writeSSE({ data: JSON.stringify(e) })
    }
    try {
      const driver = await getAgentDriver()
      for await (const event of driver(
        { text, plan: body.plan },
        { emit, signal: c.req.raw.signal },
      )) {
        await stream.writeSSE({ data: JSON.stringify(event) })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error"
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message } satisfies SseEvent) })
    }
  })
})

app.get("/automation/workflows", (c) => {
  const rawLimit = Number.parseInt(c.req.query("limit") ?? "10", 10)
  const limit = Number.isFinite(rawLimit) ? rawLimit : 10
  return c.json({ workflows: listWorkflowReplays(limit) })
})

// Validation-framework probe: report each execution provider's health + diagnostics. Seeds the
// future self-test orchestrator and lets the desktop surface integration status.
app.get("/automation/health", async (c) => {
  const providers = await Promise.all(
    allProviders().map(async (p) => {
      const health = await p
        .healthCheck()
        .catch((err) => ({
          ok: false,
          detail: err instanceof Error ? err.message : "healthCheck threw",
        }))
      const diagnostics = await p.diagnostics().catch(() => ({}))
      return { id: p.id, label: p.label, ...health, diagnostics }
    }),
  )
  return c.json({ ok: providers.every((p) => p.ok), providers })
})

// Repair a single provider, then return its fresh health + diagnostics snapshot.
app.post("/automation/providers/:id/repair", async (c) => {
  const id = c.req.param("id")
  if (!isProviderId(id)) return c.json({ error: "unknown provider" }, 404)
  const provider = getProvider(id)
  const health = await provider.repair().catch((err) => ({
    ok: false,
    detail: err instanceof Error ? err.message : "repair failed",
  }))
  const diagnostics = await provider.diagnostics().catch(() => ({}))
  return c.json({
    provider: { id: provider.id, label: provider.label, ...health, diagnostics },
  })
})

// Knowledge Base lookup: what prior experience would the agent for this goal consult? Seeds a future
// Memory Center UI and lets the desktop preview learned context before running.
app.get("/automation/knowledge", (c) => {
  const goal = c.req.query("goal")?.trim()
  if (!goal) return c.json({ error: "goal query param required" }, 400)
  const agent = resolveAgent(goal)
  const recall = recallKnowledge(agent.id, goal)
  return c.json({
    agent: { id: agent.id, label: agent.label, provider: agent.provider },
    hint: knowledgeHint(recall),
    ...recall,
  })
})

app.post("/stt", async (c) => {
  const form = await c.req.formData()
  const audio = form.get("audio")
  if (!audio || typeof audio === "string") return c.json({ error: "audio file required" }, 400)
  const bytes = new Uint8Array(await audio.arrayBuffer())
  if (bytes.byteLength <= 44) return c.json({ error: "audio file is empty" }, 400)
  try {
    const text = await transcribe(bytes)
    return c.json({ text })
  } catch (err) {
    const message = err instanceof Error ? err.message : "STT failed"
    if (message.includes("ELEVENLABS_API_KEY")) {
      console.error(`[yomi/stt] ${message}`)
      return c.json({ error: "STT is not configured: ELEVENLABS_API_KEY is missing" }, 503)
    }
    if (err instanceof ElevenLabsSttError) {
      const detail = err.body ? `: ${err.body}` : ""
      console.error(`[yomi/stt] ${err.message}${detail}`)
      return c.json({ error: `${err.message}${detail}` }, err.status >= 500 ? 502 : 400)
    }
    console.error(`[yomi/stt] ${message}`)
    return c.json({ error: message }, 502)
  }
})

// Duck/restore Spotify volume around a listening turn so the playing song doesn't drown out the
// user's voice. The desktop calls this on entering/leaving the listening state.
app.post("/spotify/duck", async (c) => {
  const body = await c.req.json().catch(() => ({}) as { duck?: boolean })
  const result = await duckSpotify(body?.duck === true)
  return c.json(result as Record<string, unknown>)
})

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: "Internal server error" }, 500)
})

// Tear down the MCP client + its child browser on shutdown.
for (const sig of ["SIGINT", "SIGTERM", "beforeExit"] as const) {
  process.on(sig, () => {
    void closeMcp().finally(() => process.exit(0))
  })
}

const port = parseInt(process.env.SIDECAR_PORT || "3002", 10)
console.warn(`Sidecar listening on :${port}`)

export default { port, fetch: app.fetch }

function isProviderId(id: string): id is ProviderId {
  return id === "native" || id === "browser" || id === "api" || id === "workflow"
}
