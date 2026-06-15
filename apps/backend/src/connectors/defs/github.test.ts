import { beforeEach, afterEach, describe, expect, it, mock, afterAll, beforeAll } from "bun:test"

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.GITHUB_INTEGRATIONS_CLIENT_ID = "Ov23lioMpKQ4tSXMLaJY"
  process.env.GITHUB_INTEGRATIONS_CLIENT_SECRET = "1f9dad831bd5cc8c6d1c2b1a9e0de7cc89926f90"
  process.env.GITHUB_CLIENT_ID = "Ov23lijL89pMm38klD0y"
  process.env.GITHUB_CLIENT_SECRET = "f80244c7069e02e1d776e1bfb2825862d3fb3825"
  process.env.BETTER_AUTH_BASE_URL = "http://localhost:3001"
  process.env.BETTER_AUTH_URL = "http://localhost:3000"
  process.env.ENCRYPTION_KEY = "03f5c50ad7461b5172d57041fef789cc7297c9bfd806a52eecba14e03201d040"
})

afterAll(() => {
  process.env = { ...originalEnv }
})

// ── Section 1: Environment variables ──────────────────────────────────────────

describe.skip("GitHub env vars", () => {
  it("1. GITHUB_INTEGRATIONS_CLIENT_ID and SECRET are set", () => {
    expect(process.env.GITHUB_INTEGRATIONS_CLIENT_ID).toBeTruthy()
    expect(process.env.GITHUB_INTEGRATIONS_CLIENT_SECRET).toBeTruthy()
  })

  it("2. GITHUB_CLIENT_ID and SECRET (Better Auth login) are set", () => {
    expect(process.env.GITHUB_CLIENT_ID).toBeTruthy()
    expect(process.env.GITHUB_CLIENT_SECRET).toBeTruthy()
  })

  it("3. Integration and login clients differ", () => {
    expect(process.env.GITHUB_INTEGRATIONS_CLIENT_ID).not.toEqual(process.env.GITHUB_CLIENT_ID)
  })
})

// ── Section 2: Connector def registration ─────────────────────────────────────

describe.skip("GitHub connector def", () => {
  beforeAll(async () => {
    await import("./github.js")
  })

  it("4. github def is registered in the connector registry", async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("github")
    expect(def).toBeDefined()
    expect(def?.id).toBe("github")
    expect(def?.name).toBe("GitHub")
    expect(def?.auth.kind).toBe("oauth2")
    expect(def?.auth.clientIdEnv).toBe("GITHUB_INTEGRATIONS_CLIENT_ID")
    expect(def?.auth.clientSecretEnv).toBe("GITHUB_INTEGRATIONS_CLIENT_SECRET")
    expect(def?.auth.redirectPath).toBe("/api/integrations/callback/github")
    expect(def?.auth.scopes).toContain("repo")
    expect(def?.auth.scopes).toContain("read:user")
  })

  it("5. tools function is defined", async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("github")
    expect(def?.tools).toBeFunction()
  })
})

// ── Section 3: Backend wrapper (display name) ────────────────────────────────

describe.skip("GitHub backend wrapper", () => {
  beforeAll(async () => {
    await import("./github.js")
  })

  it("6. getDisplayName fetches from GitHub API", async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("github")
    expect(def?.getDisplayName).toBeFunction()

    mock.restore()
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ login: "octocat", name: "Octo Cat" })),
    )
    const name = await def?.getDisplayName?.("gho_fake_token")
    expect(name).toBe("Octo Cat")
    mock.restore()
  })

  it("7. getDisplayName falls back to login if name is missing", async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("github")
    global.fetch = mock(async () =>
      new Response(JSON.stringify({ login: "octocat" })),
    )
    const name = await def?.getDisplayName?.("gho_fake_token")
    expect(name).toBe("octocat")
    mock.restore()
  })

  it("8. getDisplayName falls back to 'GitHub' on API error", async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("github")
    global.fetch = mock(async () => new Response("Unauthorized", { status: 401 }))
    const name = await def?.getDisplayName?.("gho_fake_token")
    expect(name).toBe("GitHub")
    mock.restore()
  })
})

// ── Section 4: GitHub tools with mocked API ───────────────────────────────────

describe.skip("GitHub tools", () => {
  let ghTools: Record<string, any>
  let lastRequestUrl: string

  beforeAll(async () => {
    await import("./github.js")
  })

  beforeEach(async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("github")
    const context = {
      userId: "test-user-123",
      getAccessToken: async () => "gho_fake_token",
    }
    ghTools = def?.tools(context) ?? {}
    lastRequestUrl = ""

    global.fetch = mock(async (url: string, init?: RequestInit) => {
      lastRequestUrl = url.toString()
      const path = new URL(url).pathname

      if (path === "/repos/owner/repo/pulls") {
        return new Response(JSON.stringify([
          {
            number: 1, title: "Fix bug", user: { login: "user1" },
            head: { ref: "fix-bug" }, base: { ref: "main" },
            html_url: "https://github.com/owner/repo/pull/1",
            created_at: "2024-01-01T00:00:00Z", draft: false,
          },
          {
            number: 2, title: "Add feature", user: { login: "user2" },
            head: { ref: "feat-x" }, base: { ref: "main" },
            html_url: "https://github.com/owner/repo/pull/2",
            created_at: "2024-01-02T00:00:00Z", draft: false,
          },
        ]))
      }

      if (path === "/repos/owner/repo/pulls/1") {
        return new Response(JSON.stringify({
          number: 1, title: "Fix bug", body: "Fixes the critical bug #42",
          user: { login: "user1" },
          head: { ref: "fix-bug" }, base: { ref: "main" },
          html_url: "https://github.com/owner/repo/pull/1",
          state: "open", draft: false,
          created_at: "2024-01-01T00:00:00Z",
          merged_at: null, merge_commit_sha: null,
          additions: 10, deletions: 2, changed_files: 3,
        }))
      }

      if (path === "/repos/owner/repo/issues" && !url.includes("/issues/")) {
        return new Response(JSON.stringify([
          {
            number: 42, title: "Important bug", user: { login: "user1" },
            html_url: "https://github.com/owner/repo/issues/42",
            created_at: "2024-01-01T00:00:00Z",
            labels: [{ name: "bug" }],
          },
        ]))
      }

      if (path === "/repos/owner/repo/issues/42") {
        return new Response(JSON.stringify({
          number: 42, title: "Important bug",
          body: "Steps to reproduce: 1. Click X 2. See error",
          user: { login: "user1" },
          html_url: "https://github.com/owner/repo/issues/42",
          state: "open", created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
          comments: 3,
          labels: [{ name: "bug" }, { name: "high-priority" }],
        }))
      }

      return new Response("Not Found", { status: 404 })
    })
  })

  afterEach(() => {
    mock.restore()
  })

  it("9. github.listPRs returns PRs with correct fields", async () => {
    const result = await ghTools["github.listPRs"].execute!({
      owner: "owner", repo: "repo", state: "open", limit: 10,
    })
    expect(result.count).toBe(2)
    expect(result.prs[0].title).toBe("Fix bug")
    expect(result.prs[0].author).toBe("user1")
    expect(result.prs[0].branch).toBe("fix-bug → main")
    expect(result.prs[0].url).toInclude("github.com")
    expect(result.prs[1].title).toBe("Add feature")
  })

  it("10. github.listPRs uses correct API path", async () => {
    await ghTools["github.listPRs"].execute!({
      owner: "owner", repo: "repo", state: "open", limit: 10,
    })
    expect(lastRequestUrl).toInclude("/repos/owner/repo/pulls")
  })

  it("11. github.getPR returns PR details", async () => {
    const result = await ghTools["github.getPR"].execute!({ owner: "owner", repo: "repo", prNumber: 1 })
    expect(result.title).toBe("Fix bug")
    expect(result.description).toInclude("critical bug")
    expect(result.stats.additions).toBe(10)
    expect(result.stats.deletions).toBe(2)
    expect(result.stats.filesChanged).toBe(3)
    expect(result.state).toBe("open")
  })

  it("12. github.listIssues returns issues without PRs", async () => {
    const result = await ghTools["github.listIssues"].execute!({ owner: "owner", repo: "repo", state: "open", limit: 10 })
    expect(result.count).toBe(1)
    expect(result.issues[0].title).toBe("Important bug")
    expect(result.issues[0].labels).toContain("bug")
    expect(result.issues[0].url).toInclude("github.com")
  })

  it("13. github.getIssue returns full issue details", async () => {
    const result = await ghTools["github.getIssue"].execute!({ owner: "owner", repo: "repo", issueNumber: 42 })
    expect(result.title).toBe("Important bug")
    expect(result.body).toInclude("Steps to reproduce")
    expect(result.comments).toBe(3)
    expect(result.labels).toContain("bug")
    expect(result.labels).toContain("high-priority")
    expect(result.state).toBe("open")
  })

  it("14. github.listPRs returns empty message when no results", async () => {
    global.fetch = mock(async () => new Response(JSON.stringify([])))
    const result = await ghTools["github.listPRs"].execute!({ owner: "o", repo: "r", state: "closed", limit: 10 })
    expect(result.message).toInclude("No closed PRs found")
    expect(result.prs).toBeEmpty()
  })

  it("15. tools pass Authorization header with Bearer token", async () => {
    let authHeader: string | undefined
    global.fetch = mock(async (url: string, init?: RequestInit) => {
      authHeader = (init?.headers as Record<string, string>)?.["Authorization"]
      return new Response(JSON.stringify([]))
    })
    await ghTools["github.listPRs"].execute!({ owner: "o", repo: "r", state: "open", limit: 5 })
    expect(authHeader).toBe("Bearer gho_fake_token")
  })

  it("16. tools pass correct API version header", async () => {
    let apiVersion: string | undefined
    global.fetch = mock(async (url: string, init?: RequestInit) => {
      apiVersion = (init?.headers as Record<string, string>)?.["X-GitHub-Api-Version"]
      return new Response(JSON.stringify([]))
    })
    await ghTools["github.listPRs"].execute!({ owner: "o", repo: "r", state: "open", limit: 5 })
    expect(apiVersion).toBe("2022-11-28")
  })
})
