import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import { makeComposioGitHubDef, githubComposioSpecs, GITHUB_TOOLKIT } from "./github.js"
import { createComposioTools } from "./adapter.js"
import type { ComposioExecutor } from "./adapter.js"

function fakeExecutor(result: unknown = { ok: true }): ComposioExecutor & {
  calls: { userId: string; slug: string; arguments: unknown }[]
} {
  const calls: { userId: string; slug: string; arguments: unknown }[] = []
  return {
    calls,
    execute: async (input) => {
      calls.push(input)
      return result
    },
  }
}

function buildCtx(overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    userId: "user_1",
    getAccessToken: async () => "unused-for-composio",
    ...overrides,
  }
}

describe("GitHub via Composio — ConnectorDef shape", () => {
  it("produces a ConnectorDef with the correct id and category", () => {
    const def = makeComposioGitHubDef(fakeExecutor())
    expect(def.id).toBe("github")
    expect(def.name).toBe("GitHub")
    expect(def.category).toBe("engineering")
    expect(def.auth).toEqual({
      kind: "composio",
      toolkit: GITHUB_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_GITHUB_AUTH_CONFIG_ID",
    })
  })

  it("exposes tools factory that returns tools keyed by Composio slug", () => {
    const def = makeComposioGitHubDef(fakeExecutor())
    const tools = def.tools(buildCtx())
    // A representative read tool
    expect(tools["GITHUB_LIST_REPOSITORY_ISSUES"]).toBeDefined()
    // A representative write tool
    expect(tools["GITHUB_CREATE_AN_ISSUE"]).toBeDefined()
    // An irreversible tool
    expect(tools["GITHUB_MERGE_A_PULL_REQUEST"]).toBeDefined()
  })
})

describe("GitHub via Composio — read pass-through", () => {
  it("executes a GitHub read tool directly and returns the result", async () => {
    const executor = fakeExecutor({ issues: [{ number: 1, title: "Fix bug" }] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "github",
      toolkit: GITHUB_TOOLKIT,
      specs: githubComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GITHUB_LIST_REPOSITORY_ISSUES"]!.execute({
      owner: "test-owner",
      repo: "test-repo",
    })

    expect(result).toEqual({ issues: [{ number: 1, title: "Fix bug" }] })
    expect(executor.calls).toEqual([
      {
        userId: "user_1",
        slug: "GITHUB_LIST_REPOSITORY_ISSUES",
        arguments: { owner: "test-owner", repo: "test-repo" },
      },
    ])
    expect(create).not.toHaveBeenCalled()
  })
})

describe("GitHub via Composio — write gating", () => {
  it("routes a write tool through createPendingAction and does NOT call the executor", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "github",
      toolkit: GITHUB_TOOLKIT,
      specs: githubComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GITHUB_CREATE_AN_ISSUE"]!.execute({
      owner: "test-owner",
      repo: "test-repo",
      title: "Found a bug",
      body: "Details here",
    })

    expect(executor.calls).toEqual([])
    expect(create).toHaveBeenCalledTimes(1)
    const arg = create.mock.calls[0]![0] as Record<string, unknown>
    expect(arg).toMatchObject({
      connector: "github",
      action: "GITHUB_CREATE_AN_ISSUE",
      risk: "write",
      title: "Create GitHub issue: test-owner/test-repo",
      payload: {
        owner: "test-owner",
        repo: "test-repo",
        title: "Found a bug",
        body: "Details here",
      },
    })
    expect(result).toEqual({ id: "p1", status: "pending", message: "queued" })
  })

  it("gates a merge action as irreversible", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p2", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "github",
      toolkit: GITHUB_TOOLKIT,
      specs: githubComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    await tools["GITHUB_MERGE_A_PULL_REQUEST"]!.execute({
      owner: "test-owner",
      repo: "test-repo",
      pull_number: 1,
    })

    expect((create.mock.calls[0]![0] as Record<string, unknown>)["risk"]).toBe("irreversible")
  })
})

describe("GitHub via Composio — approval replay", () => {
  it("on replay (no createPendingAction) a write runs the real executor", async () => {
    const executor = fakeExecutor({ ok: true, number: 42, html_url: "https://github.com/..." })
    const factory = createComposioTools({
      provider: "github",
      toolkit: GITHUB_TOOLKIT,
      specs: githubComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx())

    const result = await tools["GITHUB_CREATE_AN_ISSUE"]!.execute({
      owner: "test-owner",
      repo: "test-repo",
      title: "Ship it",
    })

    expect(result).toEqual({ ok: true, number: 42, html_url: "https://github.com/..." })
    expect(executor.calls).toEqual([
      {
        userId: "user_1",
        slug: "GITHUB_CREATE_AN_ISSUE",
        arguments: { owner: "test-owner", repo: "test-repo", title: "Ship it" },
      },
    ])
  })
})

describe("GitHub via Composio — error handling", () => {
  it("returns a structured connector error with reconnect hint when the executor fails", async () => {
    const executor: ComposioExecutor = {
      execute: async () => {
        throw new Error("Composio execute → status 401 unauthorized")
      },
    }
    const factory = createComposioTools({
      provider: "github",
      toolkit: GITHUB_TOOLKIT,
      specs: githubComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx())

    const result = (await tools["GITHUB_LIST_REPOSITORY_ISSUES"]!.execute({
      owner: "test-owner",
      repo: "test-repo",
    })) as { error: string; hint?: string }

    expect(result.error).toContain("401")
    expect(result.hint).toContain("reconnect")
  })
})
