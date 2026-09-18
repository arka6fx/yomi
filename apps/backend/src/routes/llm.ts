import { Hono } from "hono"
import { authenticate } from "../auth.js"

export const llmRouter = new Hono()

// Proxy OpenAI-compatible chat completions to OpenAI.
// The sidecar sends requests here when OPENAI_API_KEY is unavailable in the
// packaged env. The backend injects the real key server-side.
//
// authenticate is load-bearing: without it this route is an open relay that spends our
// OpenAI key for anyone who finds the URL, and bypasses metering entirely. Usage is
// charged by the caller up front via /interactions/reserve, so we do not charge here.
const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1"

function aiCreditsBase(): string {
  return (process.env["OPENAI_BASE_URL"] || DEFAULT_OPENAI_BASE).replace(/\/+$/, "")
}

llmRouter.all("/proxy/*", authenticate, async (c) => {
  const apiKey = process.env["OPENAI_API_KEY"]
  if (!apiKey) return c.json({ error: "OPENAI_API_KEY not configured" }, 500)

  const upstreamPath = c.req.path.replace(/^\/api\/llm\/proxy/, "")
  const body = await c.req.text().catch(() => null)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  }

  const contentType = c.req.header("content-type")
  if (contentType) headers["Content-Type"] = contentType

  // Accept-Encoding disabled — Cloudflare Workers handle decompression
  // automatically and the upstream Content-Encoding is not forwarded.
  const res = await fetch(`${aiCreditsBase()}${upstreamPath}`, {
    method: c.req.method,
    headers,
    body: body || undefined,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    return c.json(
      { error: `OpenAI upstream failed (${res.status})`, detail: text },
      res.status as 400 | 500 | 502,
    )
  }

  // Forward streaming SSE responses as-is. Use the global Response, not
  // c.newResponse, so the stream type matches across Node/Bun/Workers runtimes.
  const ct = res.headers.get("content-type") || ""
  if (ct.includes("text/event-stream") || ct.includes("application/json")) {
    return new Response(res.body, {
      status: res.status,
      headers: { "Content-Type": ct, "Cache-Control": "no-store" },
    })
  }

  return new Response(res.body, { status: res.status, headers: { "Content-Type": ct } })
})

// Legacy endpoint kept to avoid 404 for any clients still hitting it
llmRouter.post("/stream", (c) =>
  c.json({ error: "Use POST /api/llm/proxy/chat/completions instead" }, 410),
)
