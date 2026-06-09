import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { createMessagingTools } from "./messaging.js"

const BACKEND_URL = "http://localhost:3001"
const originalFetch = globalThis.fetch

describe("messaging tools", () => {
  let tools: ReturnType<typeof createMessagingTools>
  let fetchCalls: { url: string; method?: string; body?: unknown }[] = []

  beforeEach(() => {
    fetchCalls = []
    tools = createMessagingTools()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function mockFetch(response: { ok: boolean; error?: string }) {
    globalThis.fetch = (async (url: string | URL, opts?: RequestInit) => {
      fetchCalls.push({
        url: typeof url === "string" ? url : url.toString(),
        method: opts?.method,
        body: opts?.body ? JSON.parse(opts.body as string) : undefined,
      })
      return new Response(JSON.stringify(response), { status: 200 })
    }
  }

  describe("list_platforms", () => {
    it("returns result with platforms and sessions keys", () => {
      const tool = tools["list_platforms"]
      expect(tool).toBeDefined()
      expect(tool.description).toContain("sessions")
    })
  })

  describe("send_message", () => {
    it("posts to backend /api/gateway/send", async () => {
      mockFetch({ ok: true })
      const result = await tools["send_message"].execute!(
        { platform: "telegram", chatId: "-100", text: "Hello from agent" },
        {} as any,
      )
      expect(result).toEqual(expect.objectContaining({ ok: true }))
      const call = fetchCalls.find((c) => c.url.includes("/api/gateway/send"))
      expect(call).toBeDefined()
      expect((call?.body as any)?.platform).toBe("telegram")
      expect((call?.body as any)?.chatId).toBe("-100")
      expect((call?.body as any)?.text).toBe("Hello from agent")
    })

    it("rejects text over 4000 chars", async () => {
      const result = await tools["send_message"].execute!(
        { platform: "telegram", chatId: "-100", text: "x".repeat(4001) },
        {} as any,
      )
      expect(result).toEqual({ ok: false, error: "Message text must be 4000 characters or fewer" })
    })

    it("rejects empty text", async () => {
      const result = await tools["send_message"].execute!(
        { platform: "telegram", chatId: "-100", text: "" },
        {} as any,
      )
      expect(result).toEqual({ ok: false, error: "Message text cannot be empty" })
    })

    it("returns error on backend failure", async () => {
      mockFetch({ ok: false, error: "API error" })
      const result = await tools["send_message"].execute!(
        { platform: "telegram", chatId: "-100", text: "hello" },
        {} as any,
      )
      expect(result).toEqual({ ok: false, error: expect.stringContaining("API error") })
    })

    it("handles missing platform parameter", async () => {
      const result = await tools["send_message"].execute!(
        { chatId: "-100", text: "hello" } as any,
        {} as any,
      )
      expect(result).toEqual({ ok: false, error: "platform is required" })
    })
  })
})
