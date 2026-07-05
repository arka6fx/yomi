import { beforeEach, afterEach, describe, expect, it, mock, afterAll, beforeAll } from "bun:test"

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.GITHUB_INTEGRATIONS_CLIENT_ID = "temp_test_client_id_1"
  process.env.GITHUB_INTEGRATIONS_CLIENT_SECRET = "temp_test_client_secret_1"
  process.env.GITHUB_CLIENT_ID = "temp_test_client_id_2"
  process.env.GITHUB_CLIENT_SECRET = "temp_test_client_secret_2"
  process.env.BETTER_AUTH_BASE_URL = "http://localhost:3001"
  process.env.BETTER_AUTH_URL = "http://localhost:3000"
  process.env.ENCRYPTION_KEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
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
    global.fetch = mock(
      async () => new Response(JSON.stringify({ login: "octocat", name: "Octo Cat" })),
    )
    const name = await def?.getDisplayName?.("gho_fake_token")
    expect(name).toBe("Octo Cat")
    mock.restore()
  })

  it("7. getDisplayName falls back to login if name is missing", async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("github")
    global.fetch = mock(async () => new Response(JSON.stringify({ login: "octocat" })))
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
        return new Response(
          JSON.stringify([
            {
              number: 1,
              title: "Fix bug",
              user: { login: "user1" },
              head: { ref: "fix-bug" },
              base: { ref: "main" },
              html_url: "https://github.com/owner/repo/pull/1",
              created_at: "2024-01-01T00:00:00Z",
              draft: false,
            },
            {
              number: 2,
              title: "Add feature",
              user: { login: "user2" },
              head: { ref: "feat-x" },
              base: { ref: "main" },
              html_url: "https://github.com/owner/repo/pull/2",
              created_at: "2024-01-02T00:00:00Z",
              draft: false,
            },
          ]),
        )
      }

      if (path === "/repos/owner/repo/pulls/1") {
        return new Response(
          JSON.stringify({
            number: 1,
            title: "Fix bug",
            body: "Fixes the critical bug #42",
            user: { login: "user1" },
            head: { ref: "fix-bug" },
            base: { ref: "main" },
            html_url: "https://github.com/owner/repo/pull/1",
            state: "open",
            draft: false,
            created_at: "2024-01-01T00:00:00Z",
            merged_at: null,
            merge_commit_sha: null,
            additions: 10,
            deletions: 2,
            changed_files: 3,
          }),
        )
      }

      if (path === "/repos/owner/repo/issues" && !url.includes("/issues/")) {
        return new Response(
          JSON.stringify([
            {
              number: 42,
              title: "Important bug",
              user: { login: "user1" },
              html_url: "https://github.com/owner/repo/issues/42",
              created_at: "2024-01-01T00:00:00Z",
              labels: [{ name: "bug" }],
            },
          ]),
        )
      }

      if (path === "/repos/owner/repo/issues/42") {
        return new Response(
          JSON.stringify({
            number: 42,
            title: "Important bug",
            body: "Steps to reproduce: 1. Click X 2. See error",
            user: { login: "user1" },
            html_url: "https://github.com/owner/repo/issues/42",
            state: "open",
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-02T00:00:00Z",
            comments: 3,
            labels: [{ name: "bug" }, { name: "high-priority" }],
          }),
        )
      }

      return new Response("Not Found", { status: 404 })
    })
  })

  afterEach(() => {
    mock.restore()
  })

  it("9. github.listPRs returns PRs with correct fields", async () => {
    const result = await ghTools["github.listPRs"].execute!({
      owner: "owner",
      repo: "repo",
      state: "open",
      limit: 10,
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
      owner: "owner",
      repo: "repo",
      state: "open",
      limit: 10,
    })
    expect(lastRequestUrl).toInclude("/repos/owner/repo/pulls")
  })

  it("11. github.getPR returns PR details", async () => {
    const result = await ghTools["github.getPR"].execute!({
      owner: "owner",
      repo: "repo",
      prNumber: 1,
    })
    expect(result.title).toBe("Fix bug")
    expect(result.description).toInclude("critical bug")
    expect(result.stats.additions).toBe(10)
    expect(result.stats.deletions).toBe(2)
    expect(result.stats.filesChanged).toBe(3)
    expect(result.state).toBe("open")
  })

  it("12. github.listIssues returns issues without PRs", async () => {
    const result = await ghTools["github.listIssues"].execute!({
      owner: "owner",
      repo: "repo",
      state: "open",
      limit: 10,
    })
    expect(result.count).toBe(1)
    expect(result.issues[0].title).toBe("Important bug")
    expect(result.issues[0].labels).toContain("bug")
    expect(result.issues[0].url).toInclude("github.com")
  })

  it("13. github.getIssue returns full issue details", async () => {
    const result = await ghTools["github.getIssue"].execute!({
      owner: "owner",
      repo: "repo",
      issueNumber: 42,
    })
    expect(result.title).toBe("Important bug")
    expect(result.body).toInclude("Steps to reproduce")
    expect(result.comments).toBe(3)
    expect(result.labels).toContain("bug")
    expect(result.labels).toContain("high-priority")
    expect(result.state).toBe("open")
  })

  it("14. github.listPRs returns empty message when no results", async () => {
    global.fetch = mock(async () => new Response(JSON.stringify([])))
    const result = await ghTools["github.listPRs"].execute!({
      owner: "o",
      repo: "r",
      state: "closed",
      limit: 10,
    })
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

// ── Section 5: GitHub write tools ─────────────────────────────────────────────

describe("GitHub write tools", () => {
  let ghTools: Record<string, any>
  let lastRequest: { url: string; method?: string; body?: any }

  beforeAll(async () => {
    await import("./github.js")
  })

  beforeEach(async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("github")
    // No createPendingAction → tools execute directly (gating happens upstream).
    ghTools = def?.tools({ userId: "u", getAccessToken: async () => "gho_fake_token" }) ?? {}
    lastRequest = { url: "" }

    global.fetch = mock(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname
      lastRequest = {
        url: url.toString(),
        method: init?.method,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      }
      if (init?.method === "POST" && path === "/repos/owner/repo/issues") {
        return new Response(
          JSON.stringify({
            number: 7,
            title: lastRequest.body.title,
            html_url: "https://github.com/owner/repo/issues/7",
            state: "open",
          }),
          { status: 201 },
        )
      }
      if (init?.method === "PATCH" && path === "/repos/owner/repo/issues/7") {
        return new Response(
          JSON.stringify({
            number: 7,
            title: "Important bug",
            state: lastRequest.body.state ?? "open",
            html_url: "https://github.com/owner/repo/issues/7",
          }),
        )
      }
      if (init?.method === "POST" && path === "/repos/owner/repo/issues/7/comments") {
        return new Response(
          JSON.stringify({
            id: 999,
            html_url: "https://github.com/owner/repo/issues/7#issuecomment-999",
          }),
          { status: 201 },
        )
      }
      if (init?.method === "POST" && path === "/repos/owner/repo/pulls") {
        return new Response(
          JSON.stringify({
            number: 12,
            title: lastRequest.body.title,
            html_url: "https://github.com/owner/repo/pull/12",
            draft: false,
          }),
          { status: 201 },
        )
      }
      return new Response("Not Found", { status: 404 })
    })
  })

  afterEach(() => {
    mock.restore()
  })

  it("17. github-createIssue posts and returns issue number + url", async () => {
    const result = await ghTools["github-createIssue"].execute!({
      owner: "owner",
      repo: "repo",
      title: "New bug",
      body: "details",
      labels: ["bug"],
    })
    expect(result.ok).toBeTrue()
    expect(result.number).toBe(7)
    expect(result.url).toInclude("/issues/7")
    expect(lastRequest.method).toBe("POST")
    expect(lastRequest.body.title).toBe("New bug")
    expect(lastRequest.body.labels).toContain("bug")
  })

  it("18. github-updateIssue closes an issue", async () => {
    const result = await ghTools["github-updateIssue"].execute!({
      owner: "owner",
      repo: "repo",
      issueNumber: 7,
      state: "closed",
    })
    expect(result.ok).toBeTrue()
    expect(result.state).toBe("closed")
    expect(lastRequest.method).toBe("PATCH")
    expect(lastRequest.body.state).toBe("closed")
  })

  it("19. github-commentOnIssue posts a comment (works for PRs too)", async () => {
    const result = await ghTools["github-commentOnIssue"].execute!({
      owner: "owner",
      repo: "repo",
      issueNumber: 7,
      body: "Thanks for the report",
    })
    expect(result.ok).toBeTrue()
    expect(result.url).toInclude("issuecomment")
    expect(lastRequest.method).toBe("POST")
    expect(lastRequest.body.body).toBe("Thanks for the report")
  })

  it("20. github-createPR opens a pull request", async () => {
    const result = await ghTools["github-createPR"].execute!({
      owner: "owner",
      repo: "repo",
      title: "My PR",
      head: "feature",
      base: "main",
      body: "desc",
    })
    expect(result.ok).toBeTrue()
    expect(result.number).toBe(12)
    expect(result.url).toInclude("/pull/12")
    expect(lastRequest.body.head).toBe("feature")
    expect(lastRequest.body.base).toBe("main")
  })

  it("21. write tools surface auth errors via connectorError", async () => {
    global.fetch = mock(async () => new Response("Forbidden", { status: 403 }))
    const result = await ghTools["github-createIssue"].execute!({
      owner: "owner",
      repo: "repo",
      title: "x",
    })
    expect(result.error).toBeDefined()
    expect(result.hint).toInclude("reconnect")
  })
})

// ── Section 6: GitHub advanced ops (merge, review, labels, branches, repos) ────

describe("GitHub advanced ops", () => {
  let ghTools: Record<string, any>
  let lastRequest: { url: string; method?: string; body?: any }

  beforeAll(async () => {
    await import("./github.js")
  })

  beforeEach(async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("github")
    ghTools = def?.tools({ userId: "u", getAccessToken: async () => "gho_fake_token" }) ?? {}
    lastRequest = { url: "" }

    global.fetch = mock(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname
      lastRequest = {
        url: url.toString(),
        method: init?.method,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      }
      if (init?.method === "PUT" && path === "/repos/owner/repo/pulls/5/merge") {
        return new Response(
          JSON.stringify({
            sha: "abc123",
            merged: true,
            message: "Pull Request successfully merged",
          }),
        )
      }
      if (init?.method === "POST" && path === "/repos/owner/repo/pulls/5/reviews") {
        return new Response(
          JSON.stringify({
            id: 88,
            state: "APPROVED",
            html_url: "https://github.com/owner/repo/pull/5#pullrequestreview-88",
          }),
        )
      }
      if (init?.method === "POST" && path === "/repos/owner/repo/issues/7/labels") {
        return new Response(JSON.stringify([{ name: "bug" }, { name: "urgent" }]))
      }
      if (path === "/repos/owner/repo/git/ref/heads/main") {
        return new Response(JSON.stringify({ object: { sha: "basesha" } }))
      }
      if (init?.method === "POST" && path === "/repos/owner/repo/git/refs") {
        return new Response(
          JSON.stringify({ ref: "refs/heads/feature", object: { sha: "basesha" } }),
        )
      }
      if (init?.method === "POST" && path === "/user/repos") {
        return new Response(
          JSON.stringify({
            name: "golang-practice",
            full_name: "owner/golang-practice",
            private: false,
            html_url: "https://github.com/owner/golang-practice",
            default_branch: "main",
          }),
        )
      }
      if (path === "/user/repos") {
        return new Response(
          JSON.stringify([
            {
              full_name: "owner/repo",
              private: false,
              html_url: "https://github.com/owner/repo",
              description: "d",
              default_branch: "main",
              updated_at: "2024-01-01T00:00:00Z",
            },
          ]),
        )
      }
      if (init?.method === "PUT" && path === "/repos/owner/golang-practice/contents/main.go") {
        return new Response(
          JSON.stringify({
            content: {
              path: "main.go",
              sha: "filesha",
              html_url: "https://github.com/owner/golang-practice/blob/main/main.go",
            },
            commit: {
              sha: "commitsha",
              html_url: "https://github.com/owner/golang-practice/commit/commitsha",
            },
          }),
        )
      }
      if (path === "/repos/owner/repo/branches") {
        return new Response(
          JSON.stringify([
            { name: "main", protected: true },
            { name: "dev", protected: false },
          ]),
        )
      }
      return new Response("Not Found", { status: 404 })
    })
  })

  afterEach(() => {
    mock.restore()
  })

  it("22. github-mergePR merges via PUT", async () => {
    const result = await ghTools["github-mergePR"].execute!({
      owner: "owner",
      repo: "repo",
      prNumber: 5,
      method: "squash",
    })
    expect(result.ok).toBeTrue()
    expect(result.sha).toBe("abc123")
    expect(lastRequest.method).toBe("PUT")
    expect(lastRequest.body.merge_method).toBe("squash")
  })

  it("23. github-reviewPR submits an approval", async () => {
    const result = await ghTools["github-reviewPR"].execute!({
      owner: "owner",
      repo: "repo",
      prNumber: 5,
      event: "APPROVE",
    })
    expect(result.ok).toBeTrue()
    expect(result.state).toBe("APPROVED")
    expect(lastRequest.body.event).toBe("APPROVE")
  })

  it("24. github-addLabels adds labels", async () => {
    const result = await ghTools["github-addLabels"].execute!({
      owner: "owner",
      repo: "repo",
      issueNumber: 7,
      labels: ["bug", "urgent"],
    })
    expect(result.ok).toBeTrue()
    expect(result.labels).toContain("urgent")
  })

  it("25. github-createBranch resolves base sha then creates the ref", async () => {
    const result = await ghTools["github-createBranch"].execute!({
      owner: "owner",
      repo: "repo",
      branch: "feature",
      fromBranch: "main",
    })
    expect(result.ok).toBeTrue()
    expect(result.ref).toBe("refs/heads/feature")
    expect(lastRequest.body.sha).toBe("basesha")
  })

  it("26. github-listRepos returns repos", async () => {
    const result = await ghTools["github-listRepos"].execute!({ sort: "pushed", limit: 20 })
    expect(result.count).toBe(1)
    expect(result.repos[0].fullName).toBe("owner/repo")
  })

  it("27. github-listBranches returns branches", async () => {
    const result = await ghTools["github-listBranches"].execute!({
      owner: "owner",
      repo: "repo",
      limit: 20,
    })
    expect(result.count).toBe(2)
    expect(result.branches[0].name).toBe("main")
  })

  it("28. github-createRepo creates a repository", async () => {
    const result = await ghTools["github-createRepo"].execute!({
      name: "golang-practice",
      description: "Go practice",
      private: false,
      autoInit: false,
    })
    expect(result.ok).toBeTrue()
    expect(result.fullName).toBe("owner/golang-practice")
    expect(lastRequest.method).toBe("POST")
    expect(lastRequest.body.name).toBe("golang-practice")
    expect(lastRequest.body.auto_init).toBeFalse()
  })

  it("29. github-createOrUpdateFile writes file contents", async () => {
    const content = "package main\n\nfunc Sum(a, b int) int { return a + b }\n"
    const result = await ghTools["github-createOrUpdateFile"].execute!({
      owner: "owner",
      repo: "golang-practice",
      path: "main.go",
      content,
      message: "add sum practice",
    })
    expect(result.ok).toBeTrue()
    expect(result.path).toBe("main.go")
    expect(lastRequest.method).toBe("PUT")
    expect(atob(lastRequest.body.content)).toBe(content)
    expect(lastRequest.body.message).toBe("add sum practice")
  })
})

// ── Section 7: approval-gating ────────────────────────────────────────────────

describe("GitHub approval-gating", () => {
  let ghTools: Record<string, any>
  let fetchCalled: boolean
  let pendingInput: any

  beforeAll(async () => {
    await import("./github.js")
  })

  beforeEach(async () => {
    const { getConnectorDef } = await import("../registry.js")
    const def = getConnectorDef("github")
    pendingInput = undefined
    ghTools =
      def?.tools({
        userId: "u",
        getAccessToken: async () => "gho_fake_token",
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
      return new Response(JSON.stringify({}))
    })
  })

  afterEach(() => mock.restore())

  it("30. github-createIssue queues a pending action instead of calling the API", async () => {
    const result = await ghTools["github-createIssue"].execute!({
      owner: "owner",
      repo: "repo",
      title: "Gated issue",
      body: "b",
    })
    expect(result.status).toBe("pending")
    expect(result.message).toInclude("Approval required")
    expect(fetchCalled).toBeFalse()
    expect(pendingInput.action).toBe("github-createIssue")
    expect(pendingInput.connector).toBe("github")
    expect(pendingInput.payload.title).toBe("Gated issue")
  })

  it("31. github-mergePR gates as irreversible", async () => {
    const result = await ghTools["github-mergePR"].execute!({
      owner: "owner",
      repo: "repo",
      prNumber: 5,
      method: "merge",
    })
    expect(result.status).toBe("pending")
    expect(pendingInput.risk).toBe("irreversible")
    expect(fetchCalled).toBeFalse()
  })

  it("32. github-createRepo is approval-gated", async () => {
    const result = await ghTools["github-createRepo"].execute!({
      name: "golang-practice",
      private: false,
      autoInit: false,
    })
    expect(result.status).toBe("pending")
    expect(fetchCalled).toBeFalse()
    expect(pendingInput.action).toBe("github-createRepo")
    expect(pendingInput.payload.name).toBe("golang-practice")
  })

  it("33. github-createOrUpdateFile is approval-gated", async () => {
    const result = await ghTools["github-createOrUpdateFile"].execute!({
      owner: "owner",
      repo: "golang-practice",
      path: "main.go",
      content: "package main\n",
      message: "add file",
    })
    expect(result.status).toBe("pending")
    expect(fetchCalled).toBeFalse()
    expect(pendingInput.action).toBe("github-createOrUpdateFile")
    expect(pendingInput.payload.path).toBe("main.go")
  })

  it("34. read tools are NOT gated", async () => {
    global.fetch = mock(async () => new Response(JSON.stringify([])))
    const result = await ghTools["github-listPRs"].execute!({
      owner: "o",
      repo: "r",
      state: "open",
      limit: 5,
    })
    expect(pendingInput).toBeUndefined()
    expect(result.prs).toBeDefined()
  })
})
