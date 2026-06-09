import { describe, expect, it, mock, beforeEach } from "bun:test"
import { DiscordAdapter } from "./discord.js"

describe("DiscordAdapter — DM discovery", () => {
  let adapter: DiscordAdapter

  beforeEach(() => {
    adapter = new DiscordAdapter("fake-bot-token")
    ;(adapter as any).connected = true
    ;(adapter as any).botUserId = "bot-999"
  })

  it("discovers DM channels from API response", async () => {
    globalThis.fetch = mock((url: string | URL) => {
      const urlStr = url.toString()
      if (urlStr.includes("/users/@me/channels")) {
        return new Response(
          JSON.stringify([
            { id: "dm-111", type: 1, recipients: [{ id: "user-aaa" }] },
            { id: "dm-222", type: 1, recipients: [{ id: "user-bbb" }] },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any

    await (adapter as any).discoverDmChannels()

    const dmChannels: Map<string, string> = (adapter as any).dmChannels
    expect(dmChannels.size).toBe(2)
    expect(dmChannels.get("user-aaa")).toBe("dm-111")
    expect(dmChannels.get("user-bbb")).toBe("dm-222")
  })

  it("skips non-DM channels (type != 1)", async () => {
    globalThis.fetch = mock((url: string | URL) => {
      if (url.toString().includes("/users/@me/channels")) {
        return new Response(
          JSON.stringify([
            { id: "dm-111", type: 1, recipients: [{ id: "user-aaa" }] },
            { id: "guild-text", type: 0 },
            { id: "group-dm", type: 3 },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any

    await (adapter as any).discoverDmChannels()

    const dmChannels: Map<string, string> = (adapter as any).dmChannels
    expect(dmChannels.size).toBe(1)
    expect(dmChannels.has("guild-text")).toBe(false)
    expect(dmChannels.has("group-dm")).toBe(false)
  })

  it("skips channels where recipient is the bot itself", async () => {
    globalThis.fetch = mock((url: string | URL) => {
      if (url.toString().includes("/users/@me/channels")) {
        return new Response(
          JSON.stringify([
            { id: "self-dm", type: 1, recipients: [{ id: "bot-999" }] },
            { id: "real-dm", type: 1, recipients: [{ id: "user-aaa" }] },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any

    await (adapter as any).discoverDmChannels()

    const dmChannels: Map<string, string> = (adapter as any).dmChannels
    expect(dmChannels.size).toBe(1)
    expect(dmChannels.get("user-aaa")).toBe("real-dm")
    expect(dmChannels.has("self-dm")).toBe(false)
  })

  it("handles API error gracefully", async () => {
    globalThis.fetch = mock(() => {
      return new Response(null, { status: 500 })
    }) as any

    await (adapter as any).discoverDmChannels()

    const dmChannels: Map<string, string> = (adapter as any).dmChannels
    expect(dmChannels.size).toBe(0)
  })
})

describe("DiscordAdapter — DM message polling", () => {
  let adapter: DiscordAdapter
  let receivedMessages: any[] = []

  beforeEach(() => {
    receivedMessages = []
    adapter = new DiscordAdapter("fake-bot-token")
    ;(adapter as any).connected = true
    ;(adapter as any).botUserId = "bot-999"
    adapter.setMessageHandler((msg) => {
      receivedMessages.push(msg)
      console.warn("[test] messageHandler called with:", JSON.stringify(msg))
    })
  })

  it("processes user messages from DM channels", async () => {
    globalThis.fetch = mock((url: string | URL) => {
      const urlStr = url.toString()
      if (urlStr.includes("/users/@me/channels")) {
        return new Response(
          JSON.stringify([
            { id: "dm-channel-789", type: 1, recipients: [{ id: "user-aaa" }] },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      if (urlStr.includes("/users/@me/guilds")) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (urlStr.includes("/channels/dm-channel-789/messages")) {
        return new Response(
          JSON.stringify([
            {
              id: "msg-001",
              channel_id: "dm-channel-789",
              author: { id: "user-aaa", username: "testuser", bot: false },
              content: "hello from dm",
              timestamp: "2026-06-10T00:00:00Z",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any

    await (adapter as any).pollChannels()

    expect(receivedMessages.length).toBe(1)
    expect(receivedMessages[0]!.platform).toBe("discord")
    expect(receivedMessages[0]!.chatId).toBe("dm-channel-789")
    expect(receivedMessages[0]!.userId).toBe("user-aaa")
    expect(receivedMessages[0]!.text).toBe("hello from dm")
  })

  it("skips bot's own messages in DMs", async () => {
    globalThis.fetch = mock((url: string | URL) => {
      const urlStr = url.toString()
      if (urlStr.includes("/users/@me/channels")) {
        return new Response(
          JSON.stringify([
            { id: "dm-channel-789", type: 1, recipients: [{ id: "user-aaa" }] },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      if (urlStr.includes("/users/@me/guilds")) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (urlStr.includes("/channels/dm-channel-789/messages")) {
        return new Response(
          JSON.stringify([
            {
              id: "msg-002",
              channel_id: "dm-channel-789",
              author: { id: "bot-999", username: "yomi", bot: true },
              content: "Your code: ABC123",
              timestamp: "2026-06-10T00:00:00Z",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any

    await (adapter as any).pollChannels()

    expect(receivedMessages.length).toBe(0)
  })
})
