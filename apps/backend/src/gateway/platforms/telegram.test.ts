import { afterEach, describe, expect, it } from "bun:test"
import type { GatewayMessage } from "@yomi/shared"
import { TelegramAdapter, type TelegramUpdate } from "./telegram.js"
import type { PlatformCallbackEvent } from "../platform-adapter.js"

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

describe("TelegramAdapter.editMessageReplyMarkup", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("clears the inline keyboard without touching message text", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | null = null
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    const result = await adapter.editMessageReplyMarkup("42", "100")

    expect(capturedUrl).toContain("/editMessageReplyMarkup")
    expect(capturedBody?.chat_id).toBe("42")
    expect(capturedBody?.message_id).toBe(100)
    expect(capturedBody?.reply_markup).toEqual({ inline_keyboard: [] })
    expect(capturedBody?.text).toBeUndefined()
    expect(result).toEqual({ ok: true })
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

describe("TelegramAdapter.processUpdate — sticker", () => {
  it("surfaces a sticker-only update as a GatewayMessage with sticker set instead of dropping it", async () => {
    const { adapter, received } = makeAdapter()
    const update: TelegramUpdate = {
      update_id: 3,
      message: {
        message_id: 102,
        from: { id: 42, first_name: "Ada" },
        chat: { id: 42, type: "private" },
        sticker: { file_id: "sticker_file_1", emoji: "😂", set_name: "FunPack" },
      },
    }

    await adapter.processUpdate(update)

    expect(received).toHaveLength(1)
    expect(received[0]?.sticker).toEqual({ emoji: "😂", setName: "FunPack" })
    expect(received[0]?.text).toBe("")
  })
})

describe("TelegramAdapter.processUpdate — replied photo", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("uses a replied-to photo as the image for a text command", async () => {
    const { adapter, received } = makeAdapter()
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      expect(String(url)).toContain("file_id=photo_large")
      return Response.json({ ok: true, result: { file_path: "photos/replied.jpg" } })
    }) as typeof fetch

    await adapter.processUpdate({
      update_id: 4,
      message: {
        message_id: 103,
        from: { id: 42, first_name: "Ada" },
        chat: { id: 42, type: "private" },
        text: "add this image to quick notes",
        reply_to_message: {
          message_id: 102,
          chat: { id: 42, type: "private" },
          photo: [
            { file_id: "photo_small", width: 100, height: 100, file_size: 1000 },
            { file_id: "photo_large", width: 800, height: 800, file_size: 8000 },
          ],
        },
      },
    })

    expect(received).toHaveLength(1)
    expect(received[0]?.imageUrl).toBe(
      "https://api.telegram.org/file/botdummy-token/photos/replied.jpg",
    )
    expect(received[0]?.imageMimeType).toBe("image/jpeg")
    expect(received[0]?.text).toBe("add this image to quick notes")
  })
})

describe("TelegramAdapter.connect", () => {
  const originalFetch = globalThis.fetch
  const originalEnv = process.env["CORS_ORIGIN"]
  const originalBaseUrl = process.env["BETTER_AUTH_BASE_URL"]

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalEnv === undefined) delete process.env["CORS_ORIGIN"]
    else process.env["CORS_ORIGIN"] = originalEnv
    if (originalBaseUrl === undefined) delete process.env["BETTER_AUTH_BASE_URL"]
    else process.env["BETTER_AUTH_BASE_URL"] = originalBaseUrl
  })

  it("clears the command list and registers a web_app menu button pointing at /telegram-app", async () => {
    process.env["CORS_ORIGIN"] = "https://getyomi.in"
    const calls: { url: string; body: Record<string, unknown> | null }[] = []
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(url)
      calls.push({ url: urlStr, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (urlStr.includes("/getMe")) {
        return new Response(JSON.stringify({ ok: true, result: { username: "yomi_bot" } }), {
          status: 200,
        })
      }
      if (urlStr.includes("/getWebhookInfo")) {
        return new Response(JSON.stringify({ ok: true, result: { url: "" } }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await adapter.connect()

    const deleteCommandsCall = calls.find((c) => c.url.includes("/deleteMyCommands"))
    expect(deleteCommandsCall).toBeDefined()

    const menuButtonCall = calls.find((c) => c.url.includes("/setChatMenuButton"))
    expect(menuButtonCall?.body).toEqual({
      menu_button: {
        type: "web_app",
        text: "Dashboard",
        web_app: { url: "https://getyomi.in/telegram-app" },
      },
    })

    const setWebhookCall = calls.find((c) => c.url.includes("/setWebhook"))
    expect(setWebhookCall?.body?.["allowed_updates"]).toEqual(["message", "callback_query"])
  })

  it("re-registers the webhook when callback_query updates are missing", async () => {
    process.env["BETTER_AUTH_BASE_URL"] = "https://api.getyomi.in"
    const webhookUrl = "https://api.getyomi.in/api/gateway/telegram/webhook/dummy-token"
    const calls: { url: string; body: Record<string, unknown> | null }[] = []
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(url)
      calls.push({ url: urlStr, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (urlStr.includes("/getMe")) {
        return new Response(JSON.stringify({ ok: true, result: { username: "yomi_bot" } }), {
          status: 200,
        })
      }
      if (urlStr.includes("/getWebhookInfo")) {
        return new Response(
          JSON.stringify({ ok: true, result: { url: webhookUrl, allowed_updates: ["message"] } }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await adapter.connect()

    const setWebhookCall = calls.find((c) => c.url.includes("/setWebhook"))
    expect(setWebhookCall?.body).toMatchObject({
      url: webhookUrl,
      allowed_updates: ["message", "callback_query"],
    })
  })

  it("does not churn the webhook when Telegram omits allowed_updates for an otherwise healthy webhook", async () => {
    process.env["BETTER_AUTH_BASE_URL"] = "https://api.getyomi.in"
    const webhookUrl = "https://api.getyomi.in/api/gateway/telegram/webhook/dummy-token"
    const calls: { url: string; body: Record<string, unknown> | null }[] = []
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(url)
      calls.push({ url: urlStr, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (urlStr.includes("/getMe")) {
        return new Response(JSON.stringify({ ok: true, result: { username: "yomi_bot" } }), {
          status: 200,
        })
      }
      if (urlStr.includes("/getWebhookInfo")) {
        return new Response(JSON.stringify({ ok: true, result: { url: webhookUrl } }), {
          status: 200,
        })
      }
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await adapter.connect()

    expect(calls.some((c) => c.url.includes("/setWebhook"))).toBe(false)
  })
})

describe("TelegramAdapter.processUpdate — callback_query", () => {
  it("dispatches a button tap to the callback handler with the message's own chat/message id", async () => {
    const adapter = new TelegramAdapter("dummy-token")
    const received: PlatformCallbackEvent[] = []
    adapter.setCallbackHandler((event) => {
      received.push(event)
    })

    await adapter.processUpdate({
      update_id: 10,
      callback_query: {
        id: "cbq_1",
        from: { id: 42 },
        message: { message_id: 500, chat: { id: 99, type: "private" } },
        data: "approve:11111111-1111-1111-1111-111111111111",
      },
    })

    expect(received).toEqual([
      {
        chatId: "99",
        platformUserId: "42",
        messageId: "500",
        data: "approve:11111111-1111-1111-1111-111111111111",
        callbackId: "cbq_1",
      },
    ])
  })

  it("never calls the message handler for a callback_query update", async () => {
    const { adapter, received } = makeAdapter()
    adapter.setCallbackHandler(() => {})

    await adapter.processUpdate({
      update_id: 11,
      callback_query: {
        id: "cbq_2",
        from: { id: 42 },
        message: { message_id: 501, chat: { id: 99, type: "private" } },
        data: "stop",
      },
    })

    expect(received).toHaveLength(0)
  })

  it("does nothing when a callback_query has no message (e.g. an inline query result)", async () => {
    const adapter = new TelegramAdapter("dummy-token")
    const received: PlatformCallbackEvent[] = []
    adapter.setCallbackHandler((event) => {
      received.push(event)
    })

    await adapter.processUpdate({
      update_id: 12,
      callback_query: { id: "cbq_3", from: { id: 42 }, data: "stop" },
    })

    expect(received).toHaveLength(0)
  })
})

describe("TelegramAdapter.sendMessage — buttons", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("maps buttons to Telegram's inline_keyboard/callback_data shape", async () => {
    let capturedBody: Record<string, unknown> | null = null
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true, result: { message_id: 5 } }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    const result = await adapter.sendMessage("42", "Working on it…", {
      buttons: [[{ text: "⏹ Stop", callbackData: "stop" }]],
    })

    expect(capturedBody?.reply_markup).toEqual({
      inline_keyboard: [[{ text: "⏹ Stop", callback_data: "stop" }]],
    })
    expect(result).toEqual({ ok: true, messageId: "5" })
  })

  it("omits reply_markup when no buttons are given", async () => {
    let capturedBody: Record<string, unknown> | null = null
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true, result: { message_id: 6 } }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await adapter.sendMessage("42", "plain text")

    expect(capturedBody?.reply_markup).toBeUndefined()
  })
})

describe("TelegramAdapter.editMessageText", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("posts the new text and buttons to editMessageText", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | null = null
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    const result = await adapter.editMessageText("42", "500", "Denied.", {
      buttons: [[{ text: "🔄 New chat", callbackData: "new" }]],
    })

    expect(capturedUrl).toContain("/editMessageText")
    expect(capturedBody?.chat_id).toBe("42")
    expect(capturedBody?.message_id).toBe(500)
    expect(capturedBody?.text).toBe("Denied.")
    expect(capturedBody?.reply_markup).toEqual({
      inline_keyboard: [[{ text: "🔄 New chat", callback_data: "new" }]],
    })
    expect(result).toEqual({ ok: true })
  })

  it("sends an empty inline_keyboard when no buttons are given, clearing any previous ones", async () => {
    let capturedBody: Record<string, unknown> | null = null
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await adapter.editMessageText("42", "500", "Stopping the current operation.")

    expect(capturedBody?.reply_markup).toEqual({ inline_keyboard: [] })
  })

  it("surfaces a non-ok Telegram response as ok: false", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, description: "message to edit not found" }), {
        status: 400,
      })) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    const result = await adapter.editMessageText("42", "999", "text")

    expect(result).toEqual({ ok: false, error: "message to edit not found" })
  })
})

describe("TelegramAdapter.answerCallbackQuery", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("posts the callback_query_id to answerCallbackQuery", async () => {
    let capturedUrl = ""
    let capturedBody: Record<string, unknown> | null = null
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await adapter.answerCallbackQuery("cbq_1")

    expect(capturedUrl).toContain("/answerCallbackQuery")
    expect(capturedBody?.callback_query_id).toBe("cbq_1")
  })

  it("never throws when the Telegram API call fails", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down")
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await expect(adapter.answerCallbackQuery("cbq_1")).resolves.toBeUndefined()
  })
})
