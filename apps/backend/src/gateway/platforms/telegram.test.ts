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

describe("TelegramAdapter.processUpdate — replied video", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("uses a replied-to video for a text command", async () => {
    const { adapter, received } = makeAdapter()
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      expect(String(url)).toContain("file_id=video_large")
      return Response.json({ ok: true, result: { file_path: "videos/replied.mp4" } })
    }) as typeof fetch

    await adapter.processUpdate({
      update_id: 5,
      message: {
        message_id: 104,
        from: { id: 42, first_name: "Ada" },
        chat: { id: 42, type: "private" },
        text: "post this video",
        reply_to_message: {
          message_id: 103,
          chat: { id: 42, type: "private" },
          video: { file_id: "video_large", duration: 8, mime_type: "video/mp4" },
        },
      },
    })

    expect(received[0]?.videoUrl).toBe(
      "https://api.telegram.org/file/botdummy-token/videos/replied.mp4",
    )
    expect(received[0]?.videoMimeType).toBe("video/mp4")
    expect(received[0]?.text).toBe("post this video")
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
    expect(setWebhookCall?.body?.["allowed_updates"]).toEqual(["message"])
  })

  it("re-registers the webhook when message updates are missing", async () => {
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
          JSON.stringify({ ok: true, result: { url: webhookUrl, allowed_updates: ["foo"] } }),
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
      allowed_updates: ["message"],
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

  it("minimal connect skips the one-time setup but still registers the webhook", async () => {
    process.env["BETTER_AUTH_BASE_URL"] = "https://api.getyomi.in"
    const calls: string[] = []
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const urlStr = String(url)
      calls.push(urlStr)
      if (urlStr.includes("/getWebhookInfo")) {
        return new Response(JSON.stringify({ ok: true, result: { url: "" } }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await adapter.connect({ minimal: true })

    expect(calls.some((u) => u.includes("/getMe"))).toBe(false)
    expect(calls.some((u) => u.includes("/deleteMyCommands"))).toBe(false)
    expect(calls.some((u) => u.includes("/setChatMenuButton"))).toBe(false)
    expect(calls.some((u) => u.includes("/setWebhook"))).toBe(true)
  })

  it("minimal connect is a no-op on a second call in the same isolate", async () => {
    process.env["BETTER_AUTH_BASE_URL"] = "https://api.getyomi.in"
    const calls: string[] = []
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const urlStr = String(url)
      calls.push(urlStr)
      if (urlStr.includes("/getWebhookInfo")) {
        return new Response(JSON.stringify({ ok: true, result: { url: "" } }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await adapter.connect({ minimal: true })
    const afterFirst = calls.length
    await adapter.connect({ minimal: true })

    expect(calls.length).toBe(afterFirst)
  })

  it("a later full connect still runs the setup a minimal boot skipped", async () => {
    process.env["BETTER_AUTH_BASE_URL"] = "https://api.getyomi.in"
    const webhookUrl = "https://api.getyomi.in/api/gateway/telegram/webhook/dummy-token"
    const calls: string[] = []
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const urlStr = String(url)
      calls.push(urlStr)
      if (urlStr.includes("/getMe")) {
        return new Response(JSON.stringify({ ok: true, result: { username: "yomi_bot" } }), {
          status: 200,
        })
      }
      if (urlStr.includes("/getWebhookInfo")) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: { url: webhookUrl, allowed_updates: ["message"] },
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await adapter.connect({ minimal: true })
    await adapter.connect()

    expect(calls.some((u) => u.includes("/getMe"))).toBe(true)
    expect(calls.some((u) => u.includes("/deleteMyCommands"))).toBe(true)
    expect(calls.some((u) => u.includes("/setChatMenuButton"))).toBe(true)
  })
})

describe("TelegramAdapter.sendMessage — no inline keyboard", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("never attaches a reply_markup — approvals are handled as plain chat text", async () => {
    let capturedBody: Record<string, unknown> | null = null
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ ok: true, result: { message_id: 6 } }), { status: 200 })
    }) as typeof fetch

    const adapter = new TelegramAdapter("dummy-token")
    await adapter.sendMessage("42", 'Approval needed: Send email\n\nReply "yes" to approve.')

    expect(capturedBody?.reply_markup).toBeUndefined()
  })
})
