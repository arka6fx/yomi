import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { Hono } from "hono"

let mockAuthSession: { user: { id: string }; session: { id: string } } | null = null

mock.module("../auth.js", () => ({
  getAuth: () => ({ api: { getSession: async () => mockAuthSession } }),
}))

beforeEach(() => {
  mockAuthSession = null
})

async function mcpApp() {
  const { mcpRouter } = await import("./mcp.js")
  return new Hono().route("/api/mcp", mcpRouter)
}

describe("MCP server endpoint", () => {
  it("rejects an unauthenticated POST", async () => {
    const app = await mcpApp()
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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
      headers: {
        "mcp-session-id": "some-id",
      },
    })
    expect(res.status).toBe(401)
  })

  it("can initialize and discover empty tools", async () => {
    mockAuthSession = { user: { id: "u1" }, session: { id: "s1" } }
    const app = await mcpApp()

    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        authorization: "Bearer test-token",
      },
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

    expect(res.status).toBe(200)
    const sessionId = res.headers.get("mcp-session-id")
    expect(sessionId).toBeTruthy()

    const body = await res.text()
    expect(body).toContain("protocolVersion")
    expect(body).toContain("yomi")

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

    const listRes = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        authorization: "Bearer test-token",
        "mcp-session-id": sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    })

    expect(listRes.status).toBe(200)
    const listBody = await listRes.text()
    expect(listBody).toContain("tools")
  })

  it("requires mcp-session-id for GET", async () => {
    mockAuthSession = { user: { id: "u1" }, session: { id: "s1" } }
    const app = await mcpApp()
    const res = await app.request("/api/mcp", {
      method: "GET",
      headers: {
        authorization: "Bearer test-token",
      },
    })
    expect(res.status).toBe(400)
  })

  it("returns 405 for unsupported methods", async () => {
    mockAuthSession = { user: { id: "u1" }, session: { id: "s1" } }
    const app = await mcpApp()
    const res = await app.request("/api/mcp", {
      method: "PUT",
      headers: {
        authorization: "Bearer test-token",
      },
    })
    expect(res.status).toBe(405)
  })
})
