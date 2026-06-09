import { beforeEach, describe, expect, it, mock, afterEach } from "bun:test"
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

mock.module("@yomi/db", () => ({ db: fakeDb, platformConnections: {} }))

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
        { platform: "whatsapp", connected: true },
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
    expect(body.adapters).toHaveLength(3)
    expect(body.adapters[0].platform).toBe("telegram")
    expect(body.adapters[1].platform).toBe("discord")
    expect(body.adapters[2].platform).toBe("whatsapp")
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
      platform: "whatsapp",
      platformUserId: "wa-12345",
      chatId: "wa-chat-12345",
    }
    const res = await app().request("/api/gateway/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "VALID12" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.ok).toBe(true)
    expect(body.platform).toBe("whatsapp")
    // Verify DB insert was called with correct values
    expect(insertPayload).not.toBeNull()
    expect((insertPayload as any).platform).toBe("whatsapp")
    expect((insertPayload as any).platformUserId).toBe("wa-12345")
    // Verify confirmation message was sent
    expect(sentMessages.length).toBe(1)
    expect(sentMessages[0]!.platform).toBe("whatsapp")
    expect(sentMessages[0]!.text).toContain("linked")
  })
})

// ========== WhatsApp webhook ==========

describe("GET /api/gateway/webhooks/whatsapp", () => {
  it("returns challenge on valid verify request", async () => {
    const res = await app().request(
      "/api/gateway/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=yomi&hub.challenge=abc123"
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toBe("abc123")
  })

  it("returns 400 on missing params", async () => {
    const res = await app().request("/api/gateway/webhooks/whatsapp")
    expect(res.status).toBe(400)
  })

  it("returns 403 on wrong verify token", async () => {
    const res = await app().request(
      "/api/gateway/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=test"
    )
    expect(res.status).toBe(403)
  })

  it("returns 400 when mode is not subscribe", async () => {
    const res = await app().request(
      "/api/gateway/webhooks/whatsapp?hub.mode=invalid&hub.verify_token=yomi&hub.challenge=test"
    )
    expect(res.status).toBe(400)
  })
})

describe("POST /api/gateway/webhooks/whatsapp", () => {
  it("accepts valid webhook payload", async () => {
    const payload = {
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
                messages: [
                  {
                    from: "919832307332",
                    id: "wamid.test123",
                    timestamp: "1740000000",
                    type: "text",
                    text: { body: "hello yomi" },
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    }
    const res = await app().request("/api/gateway/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.status).toBe("ok")
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
        platform: "whatsapp",
        chatId: "919832307332",
        text: "Hello from test",
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.ok).toBe(true)
    expect(body.messageId).toBe("msg-test-001")
    expect(sentMessages.length).toBe(1)
    expect(sentMessages[0]!.chatId).toBe("919832307332")
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
      { platform: "whatsapp", connectedAt: new Date("2026-06-01") },
      { platform: "telegram", connectedAt: new Date("2026-06-02") },
    ]
    const res = await app().request("/api/gateway/connections")
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body).toHaveLength(2)
    expect(body[0].platform).toBe("whatsapp")
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
    const res = await app().request("/api/gateway/connections/whatsapp", {
      method: "DELETE",
    })
    expect(res.status).toBe(404)
  })

  it("unlinks valid platform", async () => {
    deleteCalls = [{ platform: "whatsapp", userId: "test-user-123" }]
    const res = await app().request("/api/gateway/connections/whatsapp", {
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
