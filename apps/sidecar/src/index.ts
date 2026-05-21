import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import type { FastQueryRequest, SseEvent } from "@yomi/shared"
import { fastPipeline } from "./pipeline/fast.js"

const app = new Hono()

const SIDECAR_SECRET = process.env.SIDECAR_SECRET
const VERSION = "0.1.0"

function authMiddleware(c: any, next: any) {
  const header = c.req.header("x-sidecar-secret")
  if (SIDECAR_SECRET && header !== SIDECAR_SECRET) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  return next()
}

async function* toLines(iterable: AsyncIterable<SseEvent>): AsyncGenerator<string> {
  for await (const event of iterable) {
    yield `data: ${JSON.stringify(event)}\n\n`
  }
}

app.use("/query/*", authMiddleware)

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

  if (!body.text?.trim()) {
    return c.json({ error: "text field is required" }, 400)
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

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: "Internal server error" }, 500)
})

const port = parseInt(process.env.SIDECAR_PORT || "3002", 10)
console.log(`Sidecar listening on :${port}`)

export default { port, fetch: app.fetch }
