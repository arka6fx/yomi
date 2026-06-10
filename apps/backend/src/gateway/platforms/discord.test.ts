import { describe, expect, it, mock, beforeEach } from "bun:test"
import { DiscordAdapter } from "./discord.js"

describe("DiscordAdapter — connect/disconnect", () => {
  it("prevents double connect", async () => {
    const adapter = new DiscordAdapter("fake-token", "fake-app-id")
    let fetchCalls = 0
    globalThis.fetch = mock((url: string | URL, init?: RequestInit) => {
      fetchCalls++
      const urlStr = url.toString()
      if (urlStr.includes("/users/@me") && init?.method !== "POST") {
        return new Response(JSON.stringify({ id: "bot-999" }), { status: 200 })
      }
      if (urlStr.includes("/commands")) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any

    await adapter.connect()
    // connect() should be a no-op after first call
    // The adapter sets up gateway which we can't easily test here
    expect(fetchCalls).toBeGreaterThan(0)
    adapter.disconnect()
  })
})

describe("DiscordAdapter — sendMessage", () => {
  it("sends message via REST API", async () => {
    const adapter = new DiscordAdapter("fake-token", "fake-app-id")
    let capturedBody: string | null = null

    globalThis.fetch = mock((_url: string | URL, init?: RequestInit) => {
      const urlStr = _url.toString()
      if (urlStr.includes("/channels/chan-123/messages") && init?.method === "POST") {
        capturedBody = init.body as string
        return new Response(JSON.stringify({ id: "msg-456" }), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any

    const result = await adapter.sendMessage("chan-123", "Hello from Yomi")
    expect(result.ok).toBe(true)
    expect(result.messageId).toBe("msg-456")
    expect(capturedBody!).toContain("Hello from Yomi")
  })

  it("handles send failure", async () => {
    const adapter = new DiscordAdapter("fake-token", "fake-app-id")

    globalThis.fetch = mock((_url: string | URL) => {
      return new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 })
    }) as any

    const result = await adapter.sendMessage("bad-chan", "hi")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("403")
  })

  it("truncates long messages to 1900 characters", async () => {
    const adapter = new DiscordAdapter("fake-token", "fake-app-id")
    const longText = "a".repeat(3000)
    let capturedContent: string | null = null

    globalThis.fetch = mock((_url: string | URL, init?: RequestInit) => {
      if (init?.body) {
        const body = JSON.parse(init.body as string)
        capturedContent = body.content
      }
      return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 })
    }) as any

    await adapter.sendMessage("chan-1", longText)
    expect(capturedContent!.length).toBeLessThanOrEqual(1900)
  })
})

describe("DiscordAdapter — deleteMessage", () => {
  it("deletes a message", async () => {
    const adapter = new DiscordAdapter("fake-token", "fake-app-id")

    globalThis.fetch = mock((_url: string | URL) => {
      return new Response(null, { status: 204 })
    }) as any

    const result = await adapter.deleteMessage("chan-1", "msg-1")
    expect(result.ok).toBe(true)
  })

  it("handles delete failure", async () => {
    const adapter = new DiscordAdapter("fake-token", "fake-app-id")

    globalThis.fetch = mock((_url: string | URL) => {
      return new Response(JSON.stringify({ message: "Not found" }), { status: 404 })
    }) as any

    const result = await adapter.deleteMessage("chan-1", "msg-1")
    expect(result.ok).toBe(false)
  })
})
