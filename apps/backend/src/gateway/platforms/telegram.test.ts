import { afterEach, describe, expect, it } from "bun:test"
import type { GatewayMessage } from "@yomi/shared"
import { TelegramAdapter, type TelegramUpdate } from "./telegram.js"

function makeAdapter() {
  const adapter = new TelegramAdapter("dummy-token")
  const received: GatewayMessage[] = []
  adapter.setMessageHandler((msg) => {
    received.push(msg)
  })
  return { adapter, received }
}

describe("TelegramAdapter.sendMessage", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("sends HTML parse_mode with markdown converted to Telegram tags", async () => {
    let capturedBody: Record<string, unknown> | null = null
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await adapter.sendMessage("42", "this is **bold** and a list:\n- one\n- two")

    expect(capturedBody?.parse_mode).toBe("HTML")
    expect(capturedBody?.text).toBe("this is <b>bold</b> and a list:\n• one\n• two")
  })
})

describe("TelegramAdapter.setReaction", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("posts a single emoji reaction to setMessageReaction", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | null = null
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    const result = await adapter.setReaction("42", "100", "🔥")

    expect(capturedUrl).toContain("/setMessageReaction")
    expect(capturedBody?.chat_id).toBe("42")
    expect(capturedBody?.message_id).toBe(100)
    expect(capturedBody?.reaction).toEqual([{ type: "emoji", emoji: "🔥" }])
    expect(result).toEqual({ ok: true })
  })

  it("surfaces a non-ok Telegram response as ok: false", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, description: "message not found" }), {
        status: 400,
      })) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    const result = await adapter.setReaction("42", "999", "👍")

    expect(result).toEqual({ ok: false, error: "message not found" })
  })
})

describe("TelegramAdapter.processUpdate — location", () => {
  it("surfaces a location-only update as a GatewayMessage with location set", async () => {
    const { adapter, received } = makeAdapter()
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 100,
        from: { id: 42, first_name: "Ada" },
        chat: { id: 42, type: "private" },
        location: { latitude: 12.9716, longitude: 77.5946 },
      },
    }

    await adapter.processUpdate(update)

    expect(received).toHaveLength(1)
    expect(received[0]?.location).toEqual({ latitude: 12.9716, longitude: 77.5946 })
    expect(received[0]?.text).toBe("")
  })

  it("still drops an update with no text, no attachments, and no location", async () => {
    const { adapter, received } = makeAdapter()
    const update: TelegramUpdate = {
      update_id: 2,
      message: {
        message_id: 101,
        from: { id: 42, first_name: "Ada" },
        chat: { id: 42, type: "private" },
      },
    }

    await adapter.processUpdate(update)

    expect(received).toHaveLength(0)
  })
})
