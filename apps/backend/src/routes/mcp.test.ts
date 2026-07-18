import { describe, it, expect, beforeEach, mock } from "bun:test"

let mockAuthSession: { user: { id: string }; session: { id: string } } | null = null

mock.module("../auth.js", () => ({
  getAuth: () => ({ api: { getSession: async () => mockAuthSession } }),
}))

const mockEntries = [
  {
    id: "m1",
    userId: "u1",
    customId: null,
    contentHash: "abc",
    kind: "fact",
    scope: "global",
    topic: "user-preference",
    summary: "User likes tea",
    content: "The user prefers tea over coffee, especially green tea.",
    status: "active",
    confidence: 90,
    sourceType: null,
    sourcePath: null,
    version: 1,
    isLatest: true,
    isStatic: true,
    rootMemoryId: null,
    parentMemoryId: null,
    forgetAfter: null,
    metadata: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  },
  {
    id: "m2",
    userId: "u1",
    customId: null,
    contentHash: "def",
    kind: "fact",
    scope: "global",
    topic: "work",
    summary: "Works at Acme Corp",
    content: "Software engineer at Acme Corp since 2024.",
    status: "active",
    confidence: 80,
    sourceType: null,
    sourcePath: null,
    version: 1,
    isLatest: true,
    isStatic: true,
    rootMemoryId: null,
    parentMemoryId: null,
    forgetAfter: null,
    metadata: null,
    createdAt: new Date("2026-01-02"),
    updatedAt: new Date("2026-01-02"),
  },
  {
    id: "m3",
    userId: "u1",
    customId: null,
    contentHash: "ghi",
    kind: "preference",
    scope: "global",
    topic: "food",
    summary: null,
    content: "Enjoys Italian cuisine, especially pasta.",
    status: "active",
    confidence: 70,
    sourceType: null,
    sourcePath: null,
    version: 1,
    isLatest: true,
    isStatic: false,
    rootMemoryId: null,
    parentMemoryId: null,
    forgetAfter: null,
    metadata: null,
    createdAt: new Date("2026-01-03"),
    updatedAt: new Date("2026-01-03"),
  },
]

const mockSchedules = [
  {
    id: "s1",
    userId: "u1",
    schedule: "every day 9am",
    scheduleType: "phrase",
    prompt: "Check my email",
    deliverTo: ["telegram"],
    enabled: true,
    oneShot: false,
    nextRunAt: new Date("2026-01-02T09:00:00Z"),
    lastRunAt: null,
    lastRunStatus: null,
    lastRunError: null,
    runCount: 0,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  },
]

let executedQueries: unknown[] = []

mock.module("@yomi/db", () => {
  const schedules = {
    __name: "schedules",
    id: {},
    userId: {},
    schedule: {},
    scheduleType: {},
    prompt: {},
    deliverTo: {},
    enabled: {},
    oneShot: {},
    nextRunAt: {},
    lastRunAt: {},
    lastRunStatus: {},
    lastRunError: {},
    runCount: {},
    createdAt: {},
    updatedAt: {},
  }

  return {
    db: {
      select: () => ({
        from: (table: unknown) => {
          if ((table as { __name?: string }).__name === "schedules") {
            return {
              where: () => ({
                orderBy: () => ({
                  limit: () => Promise.resolve(mockSchedules),
                }),
              }),
            }
          }
          if ((table as { __name?: string }).__name === "mcpConnections") {
            return {
              where: () => [],
            }
          }
          return {
            where: () => ({
              orderBy: () => ({
                limit: () => Promise.resolve(mockEntries),
              }),
            }),
          }
        },
      }),
      execute: (query: unknown) => {
        executedQueries.push(query)
        return Promise.resolve({ rows: mockEntries.map((e) => ({ ...e, score: 0.5, matchedBy: ["vector"] })) })
      },
      delete: () => ({
        where: () => Promise.resolve(),
      }),
      insert: () => ({
        values: () => Promise.resolve([{ id: "p1", status: "pending" }]),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve([{ id: "p1", status: "approved" }]),
        }),
      }),
    },
    memoryEmbeddings: { userId: {}, memoryId: {}, embedding: {} },
    memoryEntries: {
      __name: "memory_entries",
      userId: {},
      id: {},
      customId: {},
      contentHash: {},
      kind: {},
      scope: {},
      topic: {},
      summary: {},
      content: {},
      status: {},
      confidence: {},
      sourceType: {},
      sourcePath: {},
      version: {},
      isLatest: {},
      isStatic: {},
      rootMemoryId: {},
      parentMemoryId: {},
      forgetAfter: {},
      metadata: {},
      createdAt: {},
      updatedAt: {},
    },
    pendingActions: {
      __name: "pending_actions",
      id: {},
      userId: {},
      connector: {},
      action: {},
      risk: {},
      title: {},
      preview: {},
      payload: {},
      status: {},
      result: {},
      expiresAt: {},
      decidedAt: {},
      executedAt: {},
      createdAt: {},
      updatedAt: {},
    },
    schedules,
    mcpConnections: {
      __name: "mcpConnections",
      id: {},
      userId: {},
      provider: {},
      scopes: {},
      displayName: {},
      expiresAt: {},
      lastSyncAt: {},
      createdAt: {},
      updatedAt: {},
      oauthTokens: {},
    },
  }
})

mock.module("../services/privacy/checks.js", () => ({
  checkConsent: async () => ({ allowed: true, reason: null, decided: true }),
}))

mock.module("../services/pending-actions.js", () => ({
  createPendingAction: async (input: {
    userId: string
    connector: string
    action: string
    risk: string
    title: string
    preview: string
    payload: unknown
  }) => ({
    id: "pending-1",
    status: "pending",
    message: `Action pending approval: ${input.title}`,
  }),
  expirePendingActions: async () => {},
  listPendingActions: async () => [],
  denyPendingAction: async () => null,
  approvePendingAction: async () => ({ id: "approved-1", status: "approved", result: { ok: true } }),
}))

mock.module("../gateway/index.js", () => ({
  getDefaultGateway: () => ({
    sendMessage: async () => ({ ok: true }),
    getPendingMessages: async () => [],
  }),
}))

beforeEach(() => {
  mockAuthSession = null
  executedQueries = []
})

async function mcpApp() {
  const { mcpRouter } = await import("./mcp.js")
  return new (await import("hono")).Hono().route("/api/mcp", mcpRouter)
}

async function rpcCall(
  app: ReturnType<typeof Hono.prototype.route>,
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    authorization: "Bearer test-token",
  }
  if (sessionId) headers["mcp-session-id"] = sessionId

  const res = await app.request("/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  })
  return res
}

describe("MCP server endpoint", () => {
  it("rejects an unauthenticated POST", async () => {
    const app = await mcpApp()
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          clientInfo: { name: "test", version: "1" },
        },
      }),
    })
    expect(res.status).toBe(401)
  })

  it("rejects an unauthenticated GET", async () => {
    const app = await mcpApp()
    const res = await app.request("/api/mcp", {
      method: "GET",
      headers: { "mcp-session-id": "some-id" },
    })
    expect(res.status).toBe(401)
  })

  it("can initialize and discover tools", async () => {
    mockAuthSession = { user: { id: "u1" }, session: { id: "s1" } }
    const app = await mcpApp()

    const initRes = await rpcCall(app, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "test", version: "1" },
    })

    expect(initRes.status).toBe(200)
    const sessionId = initRes.headers.get("mcp-session-id")
    expect(sessionId).toBeTruthy()

    const initBody = await initRes.text()
    expect(initBody).toContain("protocolVersion")
    expect(initBody).toContain("yomi")

    const notifRes = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        authorization: "Bearer test-token",
        "mcp-session-id": sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    })
    expect(notifRes.status).toBe(202)

    const listRes = await rpcCall(app, "tools/list", {}, sessionId!)
    expect(listRes.status).toBe(200)
    const listBody = await listRes.text()
    expect(listBody).toContain("memory_search")
    expect(listBody).toContain("memory_get_profile")
    expect(listBody).toContain("memory_add")
    expect(listBody).toContain("memory_forget")
  })

  it("calls memory_search and returns results", async () => {
    mockAuthSession = { user: { id: "u1" }, session: { id: "s1" } }
    const app = await mcpApp()

    const initRes = await rpcCall(app, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "test", version: "1" },
    })
    const sessionId = initRes.headers.get("mcp-session-id")!

    await rpcCall(app, "notifications/initialized", {}, sessionId)

    const callRes = await rpcCall(app, "tools/call", { name: "memory_search", arguments: { query: "tea" } }, sessionId)
    expect(callRes.status).toBe(200)
    const body = await callRes.text()
    expect(body).toContain("content")
    expect(body).toContain("text")
  })

  it("calls memory_get_profile and returns profile", async () => {
    mockAuthSession = { user: { id: "u1" }, session: { id: "s1" } }
    const app = await mcpApp()

    const initRes = await rpcCall(app, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "test", version: "1" },
    })
    const sessionId = initRes.headers.get("mcp-session-id")!

    await rpcCall(app, "notifications/initialized", {}, sessionId)

    const callRes = await rpcCall(app, "tools/call", { name: "memory_get_profile", arguments: {} }, sessionId)
    expect(callRes.status).toBe(200)
    const body = await callRes.text()
    expect(body).toContain("content")
    expect(body).toContain("text")
  })

  it("requires mcp-session-id for GET", async () => {
    mockAuthSession = { user: { id: "u1" }, session: { id: "s1" } }
    const app = await mcpApp()
    const res = await app.request("/api/mcp", {
      method: "GET",
      headers: { authorization: "Bearer test-token" },
    })
    expect(res.status).toBe(400)
  })

  it("returns 405 for unsupported methods", async () => {
    mockAuthSession = { user: { id: "u1" }, session: { id: "s1" } }
    const app = await mcpApp()
    const res = await app.request("/api/mcp", {
      method: "PUT",
      headers: { authorization: "Bearer test-token" },
    })
    expect(res.status).toBe(405)
  })

  it("calls memory_add and creates pending action", async () => {
    mockAuthSession = { user: { id: "u1" }, session: { id: "s1" } }
    const app = await mcpApp()

    const initRes = await rpcCall(app, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "test", version: "1" },
    })
    const sessionId = initRes.headers.get("mcp-session-id")!

    await rpcCall(app, "notifications/initialized", {}, sessionId)

    const callRes = await rpcCall(
      app,
      "tools/call",
      {
        name: "memory_add",
        arguments: {
          content: "User prefers tea over coffee",
          topic: "beverage-preference",
          kind: "preference",
          scope: "global",
        },
      },
      sessionId,
    )
    expect(callRes.status).toBe(200)
    const body = await callRes.text()
    expect(body).toContain("pending approval")
  })

  it("calls memory_forget and creates pending action", async () => {
    mockAuthSession = { user: { id: "u1" }, session: { id: "s1" } }
    const app = await mcpApp()

    const initRes = await rpcCall(app, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "test", version: "1" },
    })
    const sessionId = initRes.headers.get("mcp-session-id")!

    await rpcCall(app, "notifications/initialized", {}, sessionId)

    const callRes = await rpcCall(
      app,
      "tools/call",
      {
        name: "memory_forget",
        arguments: {
          id: "m1",
          hard: false,
        },
      },
      sessionId,
    )
    expect(callRes.status).toBe(200)
    const body = await callRes.text()
    expect(body).toContain("pending approval")
  })

  it("discovers schedule tools", async () => {
    mockAuthSession = { user: { id: "u1" }, session: { id: "s1" } }
    const app = await mcpApp()

    const initRes = await rpcCall(app, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "test", version: "1" },
    })
    const sessionId = initRes.headers.get("mcp-session-id")!

    await rpcCall(app, "notifications/initialized", {}, sessionId)

    const listRes = await rpcCall(app, "tools/list", {}, sessionId)
    expect(listRes.status).toBe(200)
    const listBody = await listRes.text()
    expect(listBody).toContain("schedule_list")
    expect(listBody).toContain("schedule_create")
    expect(listBody).toContain("schedule_delete")
  })

  it("calls schedule_list and returns schedules", async () => {
    mockAuthSession = { user: { id: "u1" }, session: { id: "s1" } }
    const app = await mcpApp()

    const initRes = await rpcCall(app, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "test", version: "1" },
    })
    const sessionId = initRes.headers.get("mcp-session-id")!

    await rpcCall(app, "notifications/initialized", {}, sessionId)

    const callRes = await rpcCall(app, "tools/call", { name: "schedule_list", arguments: {} }, sessionId)
    expect(callRes.status).toBe(200)
    const body = await callRes.text()
    expect(body).toContain("content")
  })

  it("calls schedule_create and creates pending action", async () => {
    mockAuthSession = { user: { id: "u1" }, session: { id: "s1" } }
    const app = await mcpApp()

    const initRes = await rpcCall(app, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "test", version: "1" },
    })
    const sessionId = initRes.headers.get("mcp-session-id")!

    await rpcCall(app, "notifications/initialized", {}, sessionId)

    const callRes = await rpcCall(
      app,
      "tools/call",
      {
        name: "schedule_create",
        arguments: {
          schedule: "every day 9am",
          prompt: "Check my email and summarize new messages",
        },
      },
      sessionId,
    )
    expect(callRes.status).toBe(200)
    const body = await callRes.text()
    expect(body).toContain("pending approval")
  })

  it("calls schedule_delete and creates pending action", async () => {
    mockAuthSession = { user: { id: "u1" }, session: { id: "s1" } }
    const app = await mcpApp()

    const initRes = await rpcCall(app, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "test", version: "1" },
    })
    const sessionId = initRes.headers.get("mcp-session-id")!

    await rpcCall(app, "notifications/initialized", {}, sessionId)

    const callRes = await rpcCall(
      app,
      "tools/call",
      {
        name: "schedule_delete",
        arguments: {
          id: "schedule-123",
        },
      },
      sessionId,
    )
    expect(callRes.status).toBe(200)
    const body = await callRes.text()
    expect(body).toContain("pending approval")
  })

  it("execute_connector_tool returns error when connector not connected", async () => {
    mockAuthSession = { user: { id: "u1" }, session: { id: "s1" } }
    const app = await mcpApp()

    const initRes = await rpcCall(app, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "test", version: "1" },
    })
    const sessionId = initRes.headers.get("mcp-session-id")!

    await rpcCall(app, "notifications/initialized", {}, sessionId)

    const callRes = await rpcCall(
      app,
      "tools/call",
      {
        name: "execute_connector_tool",
        arguments: {
          connector: "nonexistent-connector",
          action: "someAction",
        },
      },
      sessionId,
    )
    expect(callRes.status).toBe(200)
    const body = await callRes.text()
    expect(body).toContain("is not connected")
  })
})
