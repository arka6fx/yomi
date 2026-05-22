import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import type { FastQueryRequest, SseEvent } from "@yomi/shared"
import { fastPipeline } from "./pipeline/fast.js"
import { transcribe } from "./stt.js"

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

app.use("/query/*", authMiddleware)
app.use("/stt", authMiddleware)

app.get("/health", (c) => {
  return c.json({ status: "ok", version: VERSION })
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
