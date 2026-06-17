import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { streamSSE } from "hono/streaming"
import type { AgentQueryRequest, FastQueryRequest, IntentClassification, SseEvent } from "@yomi/shared"
import { fastPipeline, resolveText } from "./pipeline/fast.js"
import { agentPipeline } from "./pipeline/agent.js"
import { transcribe } from "./stt.js"
import { classifyIntent } from "./router/intent.js"
import { initMemorySubsystem } from "./memory/subsystem.js"
// import { resolveConfirmation } from "./uia/act-bus.js" // will provide later
// import { closeMcp } from "./mcp/client.js" // will provide later
import { getDefaultScheduler } from "./tools/cron/cron-scheduler.js"
import { getDefaultPluginManager } from "./plugins/plugin-manager.js"
// import { duckSpotify } from "./tools/system.js" // will provide later
// import { getReplayCommand, listWorkflowReplays } from "./automation/runs.js"
// import { allProviders, getProvider } from "./automation/providers/registry.js"
import type { ProviderId } from "./automation/providers/types.js"
// import { resolveAgent } from "./automation/agents/registry.js"
// import { knowledgeHint, recallKnowledge } from "./automation/knowledge.js"
import { handleGatewayMessage, startGatewayPoll, stopGatewayPoll } from "./gateway/receive.js"
import { initConnectorRegistryFromSession } from "./connectors/registry.js"
import { consumePending, resolveTrigger, rejectTrigger } from "./gateway/remote-queue.js"
import type { GatewayMessage, Plan } from "@yomi/shared"
import { initUsageStore, logUsageEvent } from "./insights/usage-store.js"
import { generateReport, getMaxLookback, formatTerminal } from "./insights/insights-engine.js"

// Load .env from the sidecar binary's directory (production) or project root (dev).
// Compiled binaries don't inherit the bun --env-file flag, so we parse it manually.
function loadDotEnv(): void {
  const binDir = join(process.execPath, "..")
  const candidates = [
    join(binDir, ".env"),
    join(binDir, "..", ".env"),
    join(import.meta.dir, "..", "..", ".env"),
    join(import.meta.dir, "..", "..", "..", ".env"),
  ]
  for (const p of candidates) {
    try {
      const content = readFileSync(p, "utf8")
      for (const line of content.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const eqIdx = trimmed.indexOf("=")
        if (eqIdx === -1) continue
        const key = trimmed.slice(0, eqIdx).trim()
        const val = trimmed.slice(eqIdx + 1).trim()
        if (!(key in process.env)) process.env[key] = val
      }
      return
    } catch {
      // try next
    }
  }
}
loadDotEnv()

// Ensure ~/.yomi/ directory tree exists before serving any requests.
initMemorySubsystem().catch((err) => console.warn("[yomi] memory subsystem init failed:", err))

// Load plugins from ~/.yomi/plugins/. This runs before the cron scheduler so
// plugin hooks are available to the harness when the scheduler fires its first
// tick. Failures are non-fatal — plugins that fail to load are silently skipped.
getDefaultPluginManager().init().catch((err) => console.warn("[yomi] plugin init failed:", err))

// Initialize the local usage store (SQLite) for usage analytics.
initUsageStore().catch((err) => console.warn("[yomi] usage store init failed:", err))

// Initialize connector registry from the session token so desktop /query calls
// have connector tools available from the first request.
initConnectorRegistryFromSession().catch(() => {})

// Start the cron scheduler as a background service.
// The scheduler checks plan entitlement internally — if the plan doesn't support
// cron, the tick loop simply won't start.
getDefaultScheduler().start(process.env["YOMI_PLAN"])



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
app.use("/insights", authMiddleware)
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

    let decision: IntentClassification
    try {
      decision = await classifyIntent({
        text,
        screenshot_b64: body.screenshot_b64,
        history: body.history,
      })
    } catch (err) {
      console.warn(`[yomi/query] classifyIntent failed, defaulting to fast:`, err)
      decision = { path: "fast", confidence: 0.5, reason: "classifier error fallback", source: "heuristic" }
    }
    try {
      await stream.writeSSE({
        data: JSON.stringify({
          type: "router_decision",
          path: decision.path,
          confidence: decision.confidence,
          reason: decision.reason,
          source: decision.source,
        } satisfies SseEvent),
      })
    } catch {
      // stream closed — client disconnected
      return
    }

    const kind = decision.path === "agent" ? "agent_run" : "fast_query"
    try {
      logUsageEvent({ kind })
    } catch (err) {
      console.warn(`[yomi/query] logUsageEvent failed:`, err)
    }

    if (decision.path === "agent") {
      const agentReq: AgentQueryRequest = {
        text,
        screenshot_b64: body.screenshot_b64,
        plan: body.plan,
        history: body.history,
        tts: body.tts,
      }
      const emit = (e: SseEvent) => {
        stream.writeSSE({ data: JSON.stringify(e) }).catch(() => {})
      }
      try {
        const driver = await getAgentDriver()
        for await (const event of driver(agentReq, { emit, signal: c.req.raw.signal })) {
          await stream.writeSSE({ data: JSON.stringify(event) })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error"
        try { await stream.writeSSE({ data: JSON.stringify({ type: "error", message } satisfies SseEvent) }) } catch { /* stream closed */ }
      }
    } else {
      const normalised: FastQueryRequest = { ...body, text }
      try {
        for await (const event of fastPipeline(normalised, c.req.raw.signal)) {
          await stream.writeSSE({ data: JSON.stringify(event) })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error"
        try { await stream.writeSSE({ data: JSON.stringify({ type: "error", message } satisfies SseEvent) }) } catch { /* stream closed */ }
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
      logUsageEvent({ kind: "fast_query" })
    } catch (err) {
      console.warn(`[yomi/query/fast] logUsageEvent failed:`, err)
    }
    try {
      for await (const event of fastPipeline(body, c.req.raw.signal)) {
        await stream.writeSSE({ data: JSON.stringify(event) })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error"
      try { await stream.writeSSE({ data: JSON.stringify({ type: "error", message } satisfies SseEvent) }) } catch { /* stream closed */ }
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
    try {
      logUsageEvent({ kind: "agent_run" })
    } catch (err) {
      console.warn(`[yomi/query/agent] logUsageEvent failed:`, err)
    }
    const emit = (e: SseEvent) => {
      stream.writeSSE({ data: JSON.stringify(e) }).catch(() => {})
    }
    try {
      const driver = await getAgentDriver()
      for await (const event of driver(body, { emit, signal: c.req.raw.signal })) {
        await stream.writeSSE({ data: JSON.stringify(event) })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error"
      try { await stream.writeSSE({ data: JSON.stringify({ type: "error", message } satisfies SseEvent) }) } catch { /* stream closed */ }
    }
  })
})

// ── Desktop automation routes — will provide later ──────────────────────────
// app.post("/automation/replay", async (c) => {
// app.get("/automation/workflows", (c) => { ... });
// app.get("/automation/health", async (c) => { ... });
// app.post("/automation/providers/:id/repair", async (c) => { ... });
// app.get("/automation/knowledge", (c) => { ... });

// Act-mode confirmation callback — will provide later.
// app.post("/act/confirm", async (c) => {
//   let body: { id?: string; approved?: boolean }
//   try {
//     body = await c.req.json()
//   } catch {
//     return c.json({ error: "Invalid JSON body" }, 400)
//   }
//   if (!body.id) return c.json({ error: "id required" }, 400)
//   const resolved = resolveConfirmation(body.id, body.approved === true)
//   return c.json({ ok: resolved })
// })

// ── Automation routes — will provide later ──────────────────────────────────
// app.post("/automation/replay", async (c) => { ... });
// app.get("/automation/workflows", (c) => { ... });
// app.get("/automation/health", async (c) => { ... });
// app.post("/automation/providers/:id/repair", async (c) => { ... });
// app.get("/automation/knowledge", (c) => { ... });

app.post("/stt", async (c) => {
  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.json({ error: "Invalid form data" }, 400)
  }
  const audio = form.get("audio")
  if (!audio || typeof audio === "string") return c.json({ error: "audio file required" }, 400)
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await audio.arrayBuffer())
  } catch {
    return c.json({ error: "Invalid audio data" }, 400)
  }
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
    console.error(`[yomi/stt] ${message}`)
    return c.json({ error: message }, 502)
  }
})

// Duck/restore Spotify volume — commented out until desktop automation is re-enabled.
// app.post("/spotify/duck", async (c) => {
//   const body = await c.req.json().catch(() => ({}) as { duck?: boolean })
//   const result = await duckSpotify(body?.duck === true)
//   return c.json(result as Record<string, unknown>)
// })

// Usage insights endpoint — returns analytics report for the given lookback period.
// Query params: days (number, default 7), plan (string, default "explore").
app.get("/insights", (c) => {
  const rawDays = Number.parseInt(c.req.query("days") ?? "7", 10)
  const days = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 7
  const rawPlan = (c.req.query("plan") ?? "explore") as Plan
  const plan = rawPlan === "pro" || rawPlan === "max" ? rawPlan : "explore"
  const maxDays = getMaxLookback(plan)
  const report = generateReport(Math.min(days, maxDays), plan)
  const format = c.req.query("format")
  if (format === "terminal") {
    return c.text(formatTerminal(report))
  }
  return c.json(report)
})

// ── Gateway receive ─────────────────────────────────────────────────────────
app.post("/gateway/receive", async (c) => {
  const auth = c.req.header("Authorization")
  const secret = process.env.SIDECAR_SECRET
  if (secret && auth !== `Bearer ${secret}`) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  const msg = (await c.req.json()) as GatewayMessage
  void handleGatewayMessage(msg)
  return c.json({ ok: true })
})

// ── Remote desktop trigger queue ─────────────────────────────────────────────
// The desktop polls GET /remote/pending every few seconds. When a bot sends a
// /screenshot, /voice, or /move command, it is queued here and the desktop
// executes it, then posts the result to POST /remote/result.
app.use("/remote/*", authMiddleware)

app.get("/remote/pending", (c) => {
  return c.json({ triggers: consumePending() })
})

app.post("/remote/result", async (c) => {
  let body: { id?: string; text?: string; error?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400)
  }
  if (!body.id) return c.json({ error: "id required" }, 400)
  if (body.error) {
    rejectTrigger(body.id, body.error)
  } else {
    resolveTrigger(body.id, body.text ?? "")
  }
  return c.json({ ok: true })
})

app.onError((err, c) => {
  const path = c.req.path
  const method = c.req.method
  console.error(`[yomi] unhandled ${method} ${path}:`, err)
  const message = process.env["YOMI_DEV"] === "true"
    ? err instanceof Error ? err.message : String(err)
    : "Internal server error"
  return c.json({ error: message }, 500)
})

// Tear down on shutdown.
for (const sig of ["SIGINT", "SIGTERM", "beforeExit"] as const) {
  process.on(sig, () => {
    stopGatewayPoll()
    getDefaultScheduler().stop()
    getDefaultPluginManager().shutdown()
    // void closeMcp().finally(() => process.exit(0))
    process.exit(0)
  })
}

const port = parseInt(process.env.SIDECAR_PORT || "3002", 10)
startGatewayPoll()
console.warn(`Sidecar listening on :${port}`)

export default { port, fetch: app.fetch }

function isProviderId(id: string): id is ProviderId {
  return id === "native" || id === "api" || id === "workflow"
  // "browser" — will provide later
}
