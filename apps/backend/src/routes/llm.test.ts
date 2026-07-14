import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { Hono } from "hono"

let mockAuthSession: { user: { id: string }; session: { id: string } } | null = null

mock.module("../auth.js", () => ({
  getAuth: () => ({ api: { getSession: async () => mockAuthSession } }),
  // Re-implement rather than import: the real authenticate pulls in the full auth stack.
  authenticate: async (c: { json: (b: unknown, s: number) => Response }, next: () => Promise<void>) => {
    if (!mockAuthSession?.user) return c.json({ error: "Unauthorized" }, 401)
    await next()
  },
}))

const originalEnv = { ...process.env }

beforeEach(() => {
  mockAuthSession = null
  process.env["OPENAI_API_KEY"] = "sk-test"
})

afterEach(() => {
  globalThis.fetch = undefined as unknown as typeof globalThis.fetch
  process.env = { ...originalEnv }
})

async function llmApp() {
  const { llmRouter } = await import("./llm.js")
  return new Hono().route("/api/llm", llmRouter)
}

describe("POST /api/llm/proxy (LLM proxy)", () => {
  // This route spends our OpenAI key. Unauthenticated it is an open relay to anyone
  // who finds the URL, and it bypasses credit metering entirely.
  it("rejects an unauthenticated caller", async () => {
    const app = await llmApp()
    const res = await app.request("/api/llm/proxy/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.5", messages: [] }),
    })
    expect(res.status).toBe(401)
  })

  it("does not reach OpenAI when unauthenticated", async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response("{}", { status: 200 })
    }) as typeof fetch

    const app = await llmApp()
    await app.request("/api/llm/proxy/chat/completions", { method: "POST" })
    expect(called).toBe(false)
  })

  it("forwards to OpenAI with the server-side key for an authenticated caller", async () => {
    mockAuthSession = { user: { id: "u1" }, session: { id: "s1" } }
    let seen: { url: string; auth: string | undefined } = { url: "", auth: undefined }
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      seen = {
        url: String(url),
        auth: new Headers(init?.headers).get("authorization") ?? undefined,
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    const app = await llmApp()
    const res = await app.request("/api/llm/proxy/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.5", messages: [] }),
    })

    expect(res.status).toBe(200)
    expect(seen.url).toBe("https://api.openai.com/v1/chat/completions")
    expect(seen.auth).toBe("Bearer sk-test")
  })
})
