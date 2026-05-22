import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import type { FastQueryRequest, SseEvent } from "@yomi/shared"
import { fastPipeline, resolveText } from "./pipeline/fast.js"
import { transcribe } from "./stt.js"
import { classifyIntent } from "./router/intent.js"

const app = new Hono()

const VERSION = "0.1.0"

function authMiddleware(c: any, next: any) {
  // Read lazily so tests can manipulate the env var at runtime
  const secret = process.env.SIDECAR_SECRET
  const header = c.req.header("x-sidecar-secret")
  if (secret && header !== secret) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  return next()
}

app.use("/query", authMiddleware)
app.use("/query/*", authMiddleware)
app.use("/stt", authMiddleware)

app.get("/health", (c) => {
  return c.json({ status: "ok", version: VERSION })
})

// Unified entry point: classifies intent then routes to the appropriate pipeline.
// Phase 0: always routes to fastPipeline; agent pipeline lands in spec 08.
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
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message: "text or audio_b64 field is required" } satisfies SseEvent) })
      return
    }

    const decision = await classifyIntent({ text, screenshot_b64: body.screenshot_b64, history: body.history })
    await stream.writeSSE({
      data: JSON.stringify({
        type: "router_decision",
        path: decision.path,
        confidence: decision.confidence,
        reason: decision.reason,
        source: decision.source,
      } satisfies SseEvent),
    })

    // TODO(spec-08): swap in agentPipeline when agent route lands
    const normalised: FastQueryRequest = { ...body, text }
    try {
      for await (const event of fastPipeline(normalised)) {
        await stream.writeSSE({ data: JSON.stringify(event) })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error"
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message } satisfies SseEvent) })
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
      for await (const event of fastPipeline(body)) {
        await stream.writeSSE({ data: JSON.stringify(event) })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error"
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message } satisfies SseEvent) })
    }
  })
})

app.post("/stt", async (c) => {
  const form = await c.req.formData()
  const audio = form.get("audio")
  if (!audio || typeof audio === "string") return c.json({ error: "audio file required" }, 400)
  const bytes = new Uint8Array(await audio.arrayBuffer())
  const text = await transcribe(bytes)
  return c.json({ text })
})

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: "Internal server error" }, 500)
})

const port = parseInt(process.env.SIDECAR_PORT || "3002", 10)
console.log(`Sidecar listening on :${port}`)

export default { port, fetch: app.fetch }
