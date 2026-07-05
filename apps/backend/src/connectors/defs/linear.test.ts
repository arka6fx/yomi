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
    global.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              viewer: { name: "Alice", email: "alice@co.com", organization: { name: "Acme" } },
            },
          }),
        ),
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
    global.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              issues: {
                nodes: [
                  {
                    id: "iss-1",
                    identifier: "ENG-1",
                    title: "Fix bug",
                    state: { name: "Todo" },
                    assignee: { name: "Alice" },
                    team: { name: "Engineering" },
                    priority: 2,
                    url: "https://linear.app/issue/ENG-1",
                    updatedAt: "2024-01-01T00:00:00Z",
                  },
                ],
              },
            },
          }),
        ),
    )
    const result = await linearTools["linear.listIssues"].execute!({ limit: 15 })
    expect(result.count).toBe(1)
    expect(result.issues[0].title).toBe("Fix bug")
    expect(result.issues[0].identifier).toBe("ENG-1")
    expect(result.issues[0].priority).toBe("High")
  })

  it("7. linear.listIssues handles empty result", async () => {
    global.fetch = mock(
      async () => new Response(JSON.stringify({ data: { issues: { nodes: [] } } })),
    )
    const result = await linearTools["linear.listIssues"].execute!({ limit: 15 })
    expect(result.message).toInclude("No issues found")
  })

  it("8. linear.getIssue returns details", async () => {
    global.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              issue: {
                id: "iss-1",
                identifier: "ENG-1",
                title: "Fix bug",
                description: "Critical bug fix needed",
                state: { name: "In Progress" },
                assignee: { name: "Alice", email: "alice@co.com" },
                team: { name: "Engineering" },
                priority: 1,
                url: "https://linear.app/issue/ENG-1",
                createdAt: "2024-01-01T00:00:00Z",
                updatedAt: "2024-01-02T00:00:00Z",
                comments: {
                  nodes: [
                    {
                      body: "Working on it",
                      author: { name: "Bob" },
                      createdAt: "2024-01-01T12:00:00Z",
                    },
                  ],
                },
              },
            },
          }),
        ),
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
        return new Response(
          JSON.stringify({ data: { teams: { nodes: [{ id: "team-1", name: "Engineering" }] } } }),
        )
      }
      return new Response(
        JSON.stringify({
          data: {
            issueCreate: {
              success: true,
              issue: {
                id: "iss-new",
                identifier: "ENG-42",
                url: "https://linear.app/issue/ENG-42",
              },
            },
          },
        }),
      )
    })
    const result = await linearTools["linear.createIssue"].execute!({
      title: "New bug",
      teamName: "Engineering",
      priority: "high",
    })
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
        return new Response(
          JSON.stringify({
            data: {
              issue: {
                id: "iss-1",
                team: { states: { nodes: [{ id: "st-done", name: "Done" }] } },
              },
            },
          }),
        )
      }
      return new Response(
        JSON.stringify({
          data: {
            issueUpdate: {
              success: true,
              issue: {
                identifier: "ENG-1",
                url: "https://linear.app/issue/ENG-1",
                state: { name: "Done" },
              },
            },
          },
        }),
      )
    })
    const result = await linearTools["linear.updateIssue"].execute!({
      identifier: "ENG-1",
      state: "Done",
    })
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

// ── Linear write tools (assignee + comments) ──────────────────────────────────

describe("Linear write tools", () => {
  let linearTools: Record<string, any>

  beforeAll(async () => {
    await import("./linear.js")
  })

  beforeEach(async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("linear")
    linearTools = def?.tools({ userId: "u", getAccessToken: async () => "lin_fake_token" }) ?? {}
  })

  afterEach(() => {
    mock.restore()
  })

  it("12. linear-updateIssue assigns to me via viewer id", async () => {
    const queries: string[] = []
    let updateInput: any
    global.fetch = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}")
      queries.push(body.query ?? "")
      if (body.query?.includes("GetIssueId")) {
        return new Response(
          JSON.stringify({
            data: { issue: { id: "iss-1", team: { states: { nodes: [] } } } },
          }),
        )
      }
      if (body.query?.includes("viewer")) {
        return new Response(JSON.stringify({ data: { viewer: { id: "user-me" } } }))
      }
      updateInput = body.variables?.input
      return new Response(
        JSON.stringify({
          data: {
            issueUpdate: {
              success: true,
              issue: {
                identifier: "ENG-1",
                url: "https://linear.app/issue/ENG-1",
                state: { name: "Todo" },
              },
            },
          },
        }),
      )
    })
    const result = await linearTools["linear-updateIssue"].execute!({
      identifier: "ENG-1",
      assignee: "me",
    })
    expect(result.ok).toBeTrue()
    expect(updateInput.assigneeId).toBe("user-me")
  })

  it("13. linear-updateIssue resolves a named assignee", async () => {
    let updateInput: any
    global.fetch = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}")
      if (body.query?.includes("GetIssueId")) {
        return new Response(
          JSON.stringify({
            data: { issue: { id: "iss-1", team: { states: { nodes: [] } } } },
          }),
        )
      }
      if (body.query?.includes("users")) {
        return new Response(
          JSON.stringify({
            data: {
              users: { nodes: [{ id: "user-alice", name: "Alice", email: "alice@co.com" }] },
            },
          }),
        )
      }
      updateInput = body.variables?.input
      return new Response(
        JSON.stringify({
          data: {
            issueUpdate: {
              success: true,
              issue: { identifier: "ENG-1", url: "u", state: { name: "Todo" } },
            },
          },
        }),
      )
    })
    const result = await linearTools["linear-updateIssue"].execute!({
      identifier: "ENG-1",
      assignee: "Alice",
    })
    expect(result.ok).toBeTrue()
    expect(updateInput.assigneeId).toBe("user-alice")
  })

  it("14. linear-addComment posts a comment", async () => {
    let commentInput: any
    global.fetch = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}")
      if (body.query?.includes("GetIssueId")) {
        return new Response(JSON.stringify({ data: { issue: { id: "iss-1" } } }))
      }
      commentInput = body.variables
      return new Response(
        JSON.stringify({
          data: {
            commentCreate: {
              success: true,
              comment: { id: "c-1", url: "https://linear.app/issue/ENG-1#comment-c-1" },
            },
          },
        }),
      )
    })
    const result = await linearTools["linear-addComment"].execute!({
      identifier: "ENG-1",
      body: "Looks good",
    })
    expect(result.ok).toBeTrue()
    expect(result.url).toInclude("comment")
    expect(commentInput.body).toBe("Looks good")
  })

  it("15. linear-listTeams returns teams", async () => {
    global.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            data: { teams: { nodes: [{ id: "t1", name: "Engineering", key: "ENG" }] } },
          }),
        ),
    )
    const result = await linearTools["linear-listTeams"].execute!({})
    expect(result.count).toBe(1)
    expect(result.teams[0].key).toBe("ENG")
  })

  it("16. linear-listProjects returns projects", async () => {
    global.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              projects: {
                nodes: [
                  {
                    id: "p1",
                    name: "Q3 Launch",
                    state: "started",
                    url: "https://linear.app/project/p1",
                  },
                ],
              },
            },
          }),
        ),
    )
    const result = await linearTools["linear-listProjects"].execute!({})
    expect(result.count).toBe(1)
    expect(result.projects[0].name).toBe("Q3 Launch")
  })

  it("17. linear-listLabels returns labels", async () => {
    global.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              issueLabels: {
                nodes: [
                  { id: "l1", name: "bug" },
                  { id: "l2", name: "feature" },
                ],
              },
            },
          }),
        ),
    )
    const result = await linearTools["linear-listLabels"].execute!({})
    expect(result.labels).toContain("bug")
    expect(result.labels).toContain("feature")
  })

  it("18. linear-updateIssue moves issue to a project", async () => {
    let updateInput: any
    global.fetch = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}")
      if (body.query?.includes("GetIssueId")) {
        return new Response(
          JSON.stringify({ data: { issue: { id: "iss-1", team: { states: { nodes: [] } } } } }),
        )
      }
      if (body.query?.includes("FindProject")) {
        return new Response(
          JSON.stringify({ data: { projects: { nodes: [{ id: "proj-1", name: "Q3 Launch" }] } } }),
        )
      }
      updateInput = body.variables?.input
      return new Response(
        JSON.stringify({
          data: {
            issueUpdate: {
              success: true,
              issue: { identifier: "ENG-1", url: "u", state: { name: "Todo" } },
            },
          },
        }),
      )
    })
    const result = await linearTools["linear-updateIssue"].execute!({
      identifier: "ENG-1",
      project: "Q3",
    })
    expect(result.ok).toBeTrue()
    expect(updateInput.projectId).toBe("proj-1")
  })
})

// ── Linear approval-gating ────────────────────────────────────────────────────

describe("Linear approval-gating", () => {
  let linearTools: Record<string, any>
  let fetchCalled: boolean
  let pendingInput: any

  beforeAll(async () => {
    await import("./linear.js")
  })

  beforeEach(async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("linear")
    pendingInput = undefined
    linearTools =
      def?.tools({
        userId: "u",
        getAccessToken: async () => "lin_fake_token",
        createPendingAction: async (input: any) => {
          pendingInput = input
          return {
            id: "pa-1",
            status: "pending",
            message: `Approval required: ${input.title}. Action ID: pa-1`,
          }
        },
      }) ?? {}
    fetchCalled = false
    global.fetch = mock(async () => {
      fetchCalled = true
      return new Response(JSON.stringify({ data: {} }))
    })
  })

  afterEach(() => mock.restore())

  it("19. linear-createIssue queues a pending action", async () => {
    const result = await linearTools["linear-createIssue"].execute!({
      title: "Gated",
      teamName: "Engineering",
      priority: "high",
    })
    expect(result.status).toBe("pending")
    expect(fetchCalled).toBeFalse()
    expect(pendingInput.action).toBe("linear-createIssue")
    expect(pendingInput.connector).toBe("linear")
  })

  it("20. linear-addComment queues a pending action", async () => {
    const result = await linearTools["linear-addComment"].execute!({
      identifier: "ENG-1",
      body: "gated comment",
    })
    expect(result.status).toBe("pending")
    expect(fetchCalled).toBeFalse()
    expect(pendingInput.action).toBe("linear-addComment")
  })

  it("21. linear-updateIssue is NOT gated (reversible edit)", async () => {
    global.fetch = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}")
      if (body.query?.includes("GetIssueId")) {
        return new Response(
          JSON.stringify({
            data: {
              issue: { id: "iss-1", team: { states: { nodes: [{ id: "st", name: "Done" }] } } },
            },
          }),
        )
      }
      return new Response(
        JSON.stringify({
          data: {
            issueUpdate: {
              success: true,
              issue: { identifier: "ENG-1", url: "u", state: { name: "Done" } },
            },
          },
        }),
      )
    })
    const result = await linearTools["linear-updateIssue"].execute!({
      identifier: "ENG-1",
      state: "Done",
    })
    expect(pendingInput).toBeUndefined()
    expect(result.ok).toBeTrue()
  })
})
