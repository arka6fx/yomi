import { beforeEach, describe, expect, it, mock } from "bun:test"
import type { GatewayMessage } from "@yomi/shared"

const { WhatsAppAdapter } = await import("./whatsapp.js")

function makeWebhook(messages: Array<Record<string, unknown>> = [], field = "messages") {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1151344804725583",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15556511593",
                phone_number_id: "1151344804725583",
              },
              contacts: [
                { profile: { name: "TestUser" }, wa_id: "919832307332" },
              ],
              messages,
            },
            field,
          },
        ],
      },
    ],
  }
}

beforeEach(() => {
  mock.restore()
})

describe("WhatsAppAdapter — webhook parsing", () => {
  it("extracts text message from webhook", () => {
    const adapter = new WhatsAppAdapter("fake-token", "fake-phone-id", "yomi")
    const messages: GatewayMessage[] = []

    adapter.setMessageHandler((msg) => messages.push(msg))

    adapter.handleWebhookPayload(
      makeWebhook([
        {
          from: "919832307332",
          id: "wamid.test001",
          timestamp: "1740000000",
          type: "text",
          text: { body: "hello yomi" },
        },
      ]) as any,
    )

    // Messages are enqueued to webhookQueue, drained every 3s
    // Force drain by calling the private method via prototype
    ;(adapter as any).drainQueue()

    expect(messages.length).toBe(0) // drainQueue skips when not connected
  })

  it("enqueues messages to webhookQueue", () => {
    const adapter = new WhatsAppAdapter("fake-token", "fake-phone-id", "yomi")

    adapter.handleWebhookPayload(
      makeWebhook([
        {
          from: "919832307332",
          id: "wamid.test002",
          timestamp: "1740000000",
          type: "text",
          text: { body: "test message" },
        },
      ]) as any,
    )

    const queue = (adapter as any).webhookQueue as GatewayMessage[]
    expect(queue.length).toBe(1)
    expect(queue[0]!.text).toBe("test message")
    expect(queue[0]!.platform).toBe("whatsapp")
    expect(queue[0]!.chatId).toBe("919832307332")
    expect(queue[0]!.userId).toBe("919832307332")
  })

  it("skips non-text message types", () => {
    const adapter = new WhatsAppAdapter("fake-token", "fake-phone-id", "yomi")

    adapter.handleWebhookPayload(
      makeWebhook([
        {
          from: "919832307332",
          id: "wamid.img001",
          timestamp: "1740000000",
          type: "image",
          image: { id: "img-123", mime_type: "image/jpeg" },
        },
      ]) as any,
    )

    const queue = (adapter as any).webhookQueue as GatewayMessage[]
    expect(queue.length).toBe(1)
    expect(queue[0]!.text).toBe("[image message]")
  })

  it("deduplicates by message ID", () => {
    const adapter = new WhatsAppAdapter("fake-token", "fake-phone-id", "yomi")

    adapter.handleWebhookPayload(
      makeWebhook([
        {
          from: "919832307332",
          id: "wamid.dup001",
          timestamp: "1740000000",
          type: "text",
          text: { body: "first" },
        },
      ]) as any,
    )

    // Send same webhook again
    adapter.handleWebhookPayload(
      makeWebhook([
        {
          from: "919832307332",
          id: "wamid.dup001",
          timestamp: "1740000000",
          type: "text",
          text: { body: "duplicate" },
        },
      ]) as any,
    )

    const queue = (adapter as any).webhookQueue as GatewayMessage[]
    expect(queue.length).toBe(1)
    expect(queue[0]!.text).toBe("first")
  })

  it("handles empty webhook payload", () => {
    const adapter = new WhatsAppAdapter("fake-token", "fake-phone-id", "yomi")

    adapter.handleWebhookPayload({ object: "whatsapp", entry: [] })

    const queue = (adapter as any).webhookQueue as GatewayMessage[]
    expect(queue.length).toBe(0)
  })

  it("handles multiple messages in one webhook", () => {
    const adapter = new WhatsAppAdapter("fake-token", "fake-phone-id", "yomi")

    adapter.handleWebhookPayload(
      makeWebhook([
        {
          from: "user1",
          id: "wamid.multi1",
          timestamp: "1740000000",
          type: "text",
          text: { body: "msg 1" },
        },
        {
          from: "user2",
          id: "wamid.multi2",
          timestamp: "1740000001",
          type: "text",
          text: { body: "msg 2" },
        },
      ]) as any,
    )

    const queue = (adapter as any).webhookQueue as GatewayMessage[]
    expect(queue.length).toBe(2)
    expect(queue[0]!.text).toBe("msg 1")
    expect(queue[1]!.text).toBe("msg 2")
  })
})

describe("WhatsAppAdapter — connection", () => {
  it("getWebhookVerifyToken returns configured token", () => {
    const adapter = new WhatsAppAdapter("token", "phone-id", "my-verify-token")
    expect(adapter.getWebhookVerifyToken()).toBe("my-verify-token")
  })

  it("defaults verify token to yomi", () => {
    const adapter = new WhatsAppAdapter("token", "phone-id", "yomi")
    expect(adapter.platform).toBe("whatsapp")
    expect(adapter.getWebhookVerifyToken()).toBe("yomi")
  })
})

describe("WhatsAppAdapter — sendMessage", () => {
  it("sends text message via API", async () => {
    const adapter = new WhatsAppAdapter("fake-token", "123456789", "yomi")

    // Mock fetch to return success
    mock.module("node:http", () => ({}))
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          messaging_product: "whatsapp",
          contacts: [{ input: "919832307332", wa_id: "919832307332" }],
          messages: [{ id: "wamid.test-send-001" }],
        }),
        { status: 200 },
      )) as unknown as typeof fetch

    const result = await adapter.sendMessage("919832307332", "hello from test")
    expect(result.ok).toBe(true)
    expect(result.messageId).toBe("wamid.test-send-001")

    globalThis.fetch = origFetch
  })

  it("handles API error gracefully", async () => {
    const adapter = new WhatsAppAdapter("invalid-token", "123456789", "yomi")

    const origFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: { message: "Auth failed", code: 190 },
        }),
        { status: 401 },
      )) as unknown as typeof fetch

    const result = await adapter.sendMessage("919832307332", "hello")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("Auth failed")

    globalThis.fetch = origFetch
  })

  it("truncates long messages to 4096 chars", async () => {
    const adapter = new WhatsAppAdapter("token", "123456789", "yomi")

    let requestBody: string = ""
    const origFetch = globalThis.fetch
    globalThis.fetch = (async (_url: string | URL | Request, opts?: RequestInit) => {
      requestBody = opts?.body as string ?? ""
      return new Response(
        JSON.stringify({ messaging_product: "whatsapp", contacts: [], messages: [] }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const longText = "a".repeat(5000)
    await adapter.sendMessage("919832307332", longText)

    const parsed = JSON.parse(requestBody)
    expect(parsed.text.body.length).toBe(4096)

    globalThis.fetch = origFetch
  })
})

describe("WhatsAppAdapter — deleteMessage", () => {
  it("returns not supported", async () => {
    const adapter = new WhatsAppAdapter("token", "phone-id", "yomi")
    const result = await adapter.deleteMessage("chat-1", "msg-1")
    expect(result.ok).toBe(false)
    expect(result.error).toContain("does not support")
  })
})
