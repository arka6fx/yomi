import { beforeEach, describe, expect, it, mock, afterEach, beforeAll, afterAll } from "bun:test"
import { Hono } from "hono"

type TestUser = { id: string; email: string }

let currentUser: TestUser = { id: "test-user-123", email: "test@yomi.ai" }
let insertPayload: Record<string, unknown> | null = null
let deleteCalls: { platform: string; userId: string }[] = []
let connectionRows: { platform: string; connectedAt: Date }[] = []

const fakeDb = {
  insert: () => {
    return {
      values: (payload: Record<string, unknown>) => {
        insertPayload = payload
        return Promise.resolve()
      },
    }
  },
  select: () => ({
    from: () => ({
      where: () => {
        const rows = [...connectionRows]
        return {
          then: (fn: (r: typeof connectionRows) => unknown) => fn(rows),
          limit: () => ({
            then: (fn: (r: typeof connectionRows) => unknown) => fn(rows),
          }),
        }
      },
    }),
  }),
  delete: () => ({
    where: () => ({
      returning: () => Promise.resolve(deleteCalls.length > 0 ? [{ id: "x" }] : []),
    }),
  }),
}

let linkingCodeResult: { platform: string; platformUserId: string; chatId: string } | null = null
let sentMessages: { platform: string; chatId: string; text: string }[] = []

mock.module("@yomi/db", () => ({ db: fakeDb, platformConnections: {}, linkingCodes: {} }))

mock.module("../auth.js", () => ({
  authenticate: async (c: any, next: () => Promise<void>) => {
    c.set("user", currentUser)
    await next()
  },
}))

mock.module("./gateway-runner.js", () => ({
  getDefaultGateway: () => ({
    verifyLinkingCode: async (code: string) => {
      if (code === "VALID12") return linkingCodeResult
      return null
    },
    getStatus: () => ({
      running: true,
      adapters: [
        { platform: "telegram", connected: true },
        { platform: "discord", connected: true },
      ],
      activeSessions: 0,
    }),
    sendMessage: async (platform: string, chatId: string, text: string) => {
      sentMessages.push({ platform, chatId, text })
      return { ok: true, messageId: "msg-test-001" }
    },
    getAdapter: () => ({
      getWebhookVerifyToken: () => "yomi",
      handleWebhookPayload: () => {},
      sendMessage: async () => ({ ok: true, messageId: "test-msg" }),
    }),
    getPendingMessages: () => [],
  }),
}))

const { gatewayRouter } = await import("./routes.js")

function app() {
  const a = new Hono()
  a.route("/api/gateway", gatewayRouter)
  return a
}

beforeEach(() => {
  insertPayload = null
  deleteCalls = []
  connectionRows = []
  sentMessages = []
  linkingCodeResult = null
})

// ========== Status ==========

describe("GET /api/gateway/status", () => {
  it("returns gateway status with adapters", async () => {
    const res = await app().request("/api/gateway/status")
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.running).toBe(true)
    expect(body.adapters).toHaveLength(2)
    expect(body.adapters[0].platform).toBe("telegram")
    expect(body.adapters[1].platform).toBe("discord")
    expect(body.activeSessions).toBe(0)
  })
})

// ========== Link ==========

describe("POST /api/gateway/link", () => {
  it("rejects missing code", async () => {
    const res = await app().request("/api/gateway/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe("Missing code")
  })

  it("rejects invalid code", async () => {
    linkingCodeResult = null
    const res = await app().request("/api/gateway/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "INVALID" }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBe("Invalid or expired code")
  })

  it("links account with valid code", async () => {
    linkingCodeResult = {
      platform: "telegram",
      platformUserId: "tg-12345",
      chatId: "tg-chat-12345",
    }
    const res = await app().request("/api/gateway/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "VALID12" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.ok).toBe(true)
    expect(body.platform).toBe("telegram")
    // Verify DB insert was called with correct values
    expect(insertPayload).not.toBeNull()
    expect((insertPayload as any).platform).toBe("telegram")
    expect((insertPayload as any).platformUserId).toBe("tg-12345")
    // Verify confirmation message was sent
    expect(sentMessages.length).toBe(1)
    expect(sentMessages[0]!.platform).toBe("telegram")
    expect(sentMessages[0]!.text).toContain("linked")
  })
})

// ========== Send ==========

describe("POST /api/gateway/send", () => {
  it("rejects missing fields", async () => {
    const res = await app().request("/api/gateway/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it("sends message successfully", async () => {
    const res = await app().request("/api/gateway/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "discord",
        chatId: "dm-channel-123",
        text: "Hello from test",
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.ok).toBe(true)
    expect(body.messageId).toBe("msg-test-001")
    expect(sentMessages.length).toBe(1)
    expect(sentMessages[0]!.chatId).toBe("dm-channel-123")
  })
})

// ========== Connections ==========

describe("GET /api/gateway/connections", () => {
  it("returns empty list when no connections", async () => {
    connectionRows = []
    const res = await app().request("/api/gateway/connections")
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body).toEqual([])
  })

  it("returns linked platforms", async () => {
    connectionRows = [
      { platform: "discord", connectedAt: new Date("2026-06-01") },
      { platform: "telegram", connectedAt: new Date("2026-06-02") },
    ]
    const res = await app().request("/api/gateway/connections")
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body).toHaveLength(2)
    expect(body[0].platform).toBe("discord")
    expect(body[1].platform).toBe("telegram")
  })
})

describe("DELETE /api/gateway/connections/:platform", () => {
  it("rejects invalid platform", async () => {
    const res = await app().request("/api/gateway/connections/invalid", {
      method: "DELETE",
    })
    expect(res.status).toBe(400)
  })

  it("returns 404 when no connection exists", async () => {
    deleteCalls = []
    const res = await app().request("/api/gateway/connections/discord", {
      method: "DELETE",
    })
    expect(res.status).toBe(404)
  })

  it("unlinks valid platform", async () => {
    deleteCalls = [{ platform: "discord", userId: "test-user-123" }]
    const res = await app().request("/api/gateway/connections/discord", {
      method: "DELETE",
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.ok).toBe(true)
  })
})

// ========== Pending messages ==========

describe("GET /api/gateway/pending", () => {
  it("returns empty messages array", async () => {
    const res = await app().request("/api/gateway/pending")
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.messages).toEqual([])
  })
})

// ========== Discord OAuth ==========

describe("GET /api/gateway/discord/auth", () => {
  afterEach(() => {
    delete process.env["DISCORD_CLIENT_ID"]
    delete process.env["DISCORD_REDIRECT_URI"]
  })

  it("redirects to error when env vars missing", async () => {
    delete process.env["DISCORD_CLIENT_ID"]
    const res = await app().request("/api/gateway/discord/auth")
    expect(res.status).toBe(302)
    const location = res.headers.get("Location")
    expect(location).toContain("error=discord_not_configured")
  })

  it("redirects to Discord OAuth with correct params", async () => {
    process.env["DISCORD_CLIENT_ID"] = "1513769981773480068"
    process.env["DISCORD_REDIRECT_URI"] = "http://localhost:3001/api/gateway/discord/callback"

    const res = await app().request("/api/gateway/discord/auth")
    expect(res.status).toBe(302)
    const url = new URL(res.headers.get("Location")!)
    expect(url.host).toBe("discord.com")
    expect(url.pathname).toBe("/api/oauth2/authorize")
    expect(url.searchParams.get("client_id")).toBe("1513769981773480068")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3001/api/gateway/discord/callback")
    expect(url.searchParams.get("scope")).toBe("identify")
    expect(url.searchParams.get("state")).toBeTruthy()
  })
})

describe("GET /api/gateway/discord/callback", () => {
  let savedEnv: Record<string, string | undefined> = {}

  beforeAll(() => {
    savedEnv["DISCORD_CLIENT_ID"] = process.env["DISCORD_CLIENT_ID"]
    savedEnv["DISCORD_REDIRECT_URI"] = process.env["DISCORD_REDIRECT_URI"]
    savedEnv["DISCORD_CLIENT_SECRET"] = process.env["DISCORD_CLIENT_SECRET"]
    savedEnv["DISCORD_BOT_TOKEN"] = process.env["DISCORD_BOT_TOKEN"]
  })

  afterAll(() => {
    process.env["DISCORD_CLIENT_ID"] = savedEnv["DISCORD_CLIENT_ID"]
    process.env["DISCORD_REDIRECT_URI"] = savedEnv["DISCORD_REDIRECT_URI"]
    process.env["DISCORD_CLIENT_SECRET"] = savedEnv["DISCORD_CLIENT_SECRET"]
    process.env["DISCORD_BOT_TOKEN"] = savedEnv["DISCORD_BOT_TOKEN"]
  })

  it("redirects with error when code is missing", async () => {
    const res = await app().request("/api/gateway/discord/callback?state=abc")
    expect(res.status).toBe(302)
    expect(res.headers.get("Location")).toContain("error=discord_auth_failed")
  })

  it("redirects with error when state is missing", async () => {
    const res = await app().request("/api/gateway/discord/callback?code=xyz")
    expect(res.status).toBe(302)
    expect(res.headers.get("Location")).toContain("error=discord_auth_failed")
  })

  it("redirects with error for invalid state", async () => {
    const res = await app().request("/api/gateway/discord/callback?code=xyz&state=invalid")
    expect(res.status).toBe(302)
    expect(res.headers.get("Location")).toContain("error=discord_auth_failed")
  })

  it("redirects with error when env vars missing after valid state", async () => {
    process.env["DISCORD_CLIENT_ID"] = "1513769981773480068"
    process.env["DISCORD_REDIRECT_URI"] = "http://localhost:3001/api/gateway/discord/callback"

    const authRes = await app().request("/api/gateway/discord/auth")
    const state = new URL(authRes.headers.get("Location")!).searchParams.get("state")!

    delete process.env["DISCORD_CLIENT_SECRET"]

    const res = await app().request(`/api/gateway/discord/callback?code=xyz&state=${state}`)
    expect(res.status).toBe(302)
    expect(res.headers.get("Location")).toContain("error=discord_not_configured")
  })

  it("handles full OAuth flow and redirects with success", async () => {
    process.env["DISCORD_CLIENT_ID"] = "1513769981773480068"
    process.env["DISCORD_REDIRECT_URI"] = "http://localhost:3001/api/gateway/discord/callback"
    process.env["DISCORD_CLIENT_SECRET"] = "test-secret"
    process.env["DISCORD_BOT_TOKEN"] = "test-bot-token"

    const authRes = await app().request("/api/gateway/discord/auth")
    const state = new URL(authRes.headers.get("Location")!).searchParams.get("state")!

    const originalFetch = globalThis.fetch
    globalThis.fetch = mock((url: string | URL) => {
      const urlStr = url.toString()
      if (urlStr.includes("oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "mock-access" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (urlStr.includes("/users/@me") && !urlStr.includes("channels")) {
        return new Response(JSON.stringify({ id: "discord-user-456", username: "testuser" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      if (urlStr.includes("/users/@me/channels")) {
        return new Response(JSON.stringify({ id: "dm-channel-789" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any

    try {
      const res = await app().request(`/api/gateway/discord/callback?code=mock-code&state=${state}`)
      expect(res.status).toBe(302)
      expect(res.headers.get("Location")).toContain("discord_ready=true")
      expect(insertPayload).not.toBeNull()
      expect((insertPayload as any).platform).toBe("discord")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
