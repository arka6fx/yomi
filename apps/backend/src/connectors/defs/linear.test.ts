import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.LINEAR_CLIENT_ID = "temp_test_client_id"
  process.env.LINEAR_CLIENT_SECRET = "temp_test_client_secret"
  process.env.BETTER_AUTH_BASE_URL = "http://localhost:3001"
  process.env.BETTER_AUTH_URL = "http://localhost:3000"
  process.env.ENCRYPTION_KEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
})

afterAll(() => {
  process.env = { ...originalEnv }
})

describe.skip("Linear connector def", () => {
  beforeAll(async () => {
    await import("./linear.js")
  })

  it("1. env vars are set", () => {
    expect(process.env.LINEAR_CLIENT_ID).toBeTruthy()
    expect(process.env.LINEAR_CLIENT_SECRET).toBeTruthy()
  })

  it("2. connector is registered", async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("linear")
    expect(def).toBeDefined()
    expect(def?.id).toBe("linear")
    expect(def?.auth.clientIdEnv).toBe("LINEAR_CLIENT_ID")
    expect(def?.auth.redirectPath).toBe("/api/integrations/callback/linear")
    expect(def?.auth.scopes).toContain("read")
    expect(def?.auth.scopes).toContain("write")
  })

  it("3. tools function is defined", async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("linear")
    expect(def?.tools).toBeFunction()
  })
})

describe.skip("Linear backend wrapper", () => {
  beforeAll(async () => {
    await import("./linear.js")
  })

  it("4. getDisplayName fetches viewer info", async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("linear")
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        data: { viewer: { name: "Alice", email: "alice@co.com", organization: { name: "Acme" } } },
      })),
    )
    const name = await def?.getDisplayName?.("lin_fake")
    expect(name).toBe("Alice (Acme)")
    mock.restore()
  })

  it("5. getDisplayName falls back on API error", async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("linear")
    global.fetch = mock(async () => new Response("Unauthorized", { status: 401 }))
    const name = await def?.getDisplayName?.("lin_fake")
    expect(name).toBe("Linear")
    mock.restore()
  })
})

describe.skip("Linear tools", () => {
  let linearTools: Record<string, any>

  beforeAll(async () => {
    await import("./linear.js")
  })

  beforeEach(async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("linear")
    const context = {
      userId: "test-user-123",
      getAccessToken: async () => "lin_fake_token",
    }
    linearTools = def?.tools(context) ?? {}
  })

  afterEach(() => {
    mock.restore()
  })

  it("6. linear.listIssues returns issues", async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        data: {
          issues: {
            nodes: [
              { id: "iss-1", identifier: "ENG-1", title: "Fix bug", state: { name: "Todo" }, assignee: { name: "Alice" }, team: { name: "Engineering" }, priority: 2, url: "https://linear.app/issue/ENG-1", updatedAt: "2024-01-01T00:00:00Z" },
            ],
          },
        },
      })),
    )
    const result = await linearTools["linear.listIssues"].execute!({ limit: 15 })
    expect(result.count).toBe(1)
    expect(result.issues[0].title).toBe("Fix bug")
    expect(result.issues[0].identifier).toBe("ENG-1")
    expect(result.issues[0].priority).toBe("High")
  })

  it("7. linear.listIssues handles empty result", async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ data: { issues: { nodes: [] } } })),
    )
    const result = await linearTools["linear.listIssues"].execute!({ limit: 15 })
    expect(result.message).toInclude("No issues found")
  })

  it("8. linear.getIssue returns details", async () => {
    global.fetch = mock(async () =>
      new Response(JSON.stringify({
        data: {
          issue: {
            id: "iss-1", identifier: "ENG-1", title: "Fix bug", description: "Critical bug fix needed",
            state: { name: "In Progress" }, assignee: { name: "Alice", email: "alice@co.com" },
            team: { name: "Engineering" }, priority: 1, url: "https://linear.app/issue/ENG-1",
            createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-02T00:00:00Z",
            comments: { nodes: [{ body: "Working on it", author: { name: "Bob" }, createdAt: "2024-01-01T12:00:00Z" }] },
          },
        },
      })),
    )
    const result = await linearTools["linear.getIssue"].execute!({ identifier: "ENG-1" })
    expect(result.title).toBe("Fix bug")
    expect(result.description).toInclude("Critical bug fix")
    expect(result.comments.length).toBe(1)
    expect(result.comments[0].author).toBe("Bob")
  })

  it("9. linear.createIssue creates an issue", async () => {
    let callCount = 0
    global.fetch = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}")
      callCount++
      if (body.query?.includes("teams")) {
        return new Response(JSON.stringify({ data: { teams: { nodes: [{ id: "team-1", name: "Engineering" }] } } }))
      }
      return new Response(JSON.stringify({
        data: { issueCreate: { success: true, issue: { id: "iss-new", identifier: "ENG-42", url: "https://linear.app/issue/ENG-42" } } },
      }))
    })
    const result = await linearTools["linear.createIssue"].execute!({ title: "New bug", teamName: "Engineering", priority: "high" })
    expect(result.ok).toBeTrue()
    expect(result.identifier).toBe("ENG-42")
    expect(callCount).toBe(2)
  })

  it("10. linear.updateIssue updates state", async () => {
    let callCount = 0
    global.fetch = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}")
      callCount++
      if (body.query?.includes("GetIssueId")) {
        return new Response(JSON.stringify({
          data: { issue: { id: "iss-1", team: { states: { nodes: [{ id: "st-done", name: "Done" }] } } } },
        }))
      }
      return new Response(JSON.stringify({
        data: { issueUpdate: { success: true, issue: { identifier: "ENG-1", url: "https://linear.app/issue/ENG-1", state: { name: "Done" } } } },
      }))
    })
    const result = await linearTools["linear.updateIssue"].execute!({ identifier: "ENG-1", state: "Done" })
    expect(result.ok).toBeTrue()
    expect(callCount).toBe(2)
  })

  it("11. tools pass Bearer token", async () => {
    let authHeader: string | undefined
    global.fetch = mock(async (_url: string, init?: RequestInit) => {
      authHeader = (init?.headers as Record<string, string>)?.["Authorization"]
      return new Response(JSON.stringify({ data: { issues: { nodes: [] } } }))
    })
    await linearTools["linear.listIssues"].execute!({ limit: 5 })
    expect(authHeader).toBe("Bearer lin_fake_token")
  })
})
