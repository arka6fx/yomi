import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import { makeComposioNotionDef, notionComposioSpecs, NOTION_TOOLKIT } from "./notion.js"
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

describe("Notion via Composio — ConnectorDef shape", () => {
  it("produces a ConnectorDef with the correct id and category", () => {
    const def = makeComposioNotionDef(fakeExecutor())
    expect(def.id).toBe("notion")
    expect(def.name).toBe("Notion")
    expect(def.category).toBe("knowledge")
    expect(def.auth).toEqual({
      kind: "composio",
      toolkit: NOTION_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_NOTION_AUTH_CONFIG_ID",
    })
  })

  it("exposes tools factory that returns tools keyed by Composio slug", () => {
    const def = makeComposioNotionDef(fakeExecutor())
    const tools = def.tools(buildCtx())
    // A representative read tool
    expect(tools["NOTION_SEARCH_NOTION_PAGE"]).toBeDefined()
    // A representative write tool
    expect(tools["NOTION_CREATE_NOTION_PAGE"]).toBeDefined()
    // An irreversible tool
    expect(tools["NOTION_ARCHIVE_NOTION_PAGE"]).toBeDefined()
  })
})

describe("Notion via Composio — read pass-through", () => {
  it("executes a Notion read tool directly and returns the result", async () => {
    const executor = fakeExecutor({ results: [{ id: "p1", title: "Meeting notes" }] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "notion",
      toolkit: NOTION_TOOLKIT,
      specs: notionComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["NOTION_SEARCH_NOTION_PAGE"]!.execute({
      query: "meeting",
    })

    expect(result).toEqual({ results: [{ id: "p1", title: "Meeting notes" }] })
    expect(executor.calls).toEqual([
      {
        userId: "user_1",
        slug: "NOTION_SEARCH_NOTION_PAGE",
        arguments: { query: "meeting" },
      },
    ])
    expect(create).not.toHaveBeenCalled()
  })
})

describe("Notion via Composio — write gating", () => {
  it("routes a createPage write tool through createPendingAction and does NOT call the executor", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "notion",
      toolkit: NOTION_TOOLKIT,
      specs: notionComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["NOTION_CREATE_NOTION_PAGE"]!.execute({
      parent_id: "parent123",
      title: "New page",
      markdown: "Content here",
    })

    expect(executor.calls).toEqual([])
    expect(create).toHaveBeenCalledTimes(1)
    const arg = create.mock.calls[0]![0] as Record<string, unknown>
    expect(arg).toMatchObject({
      connector: "notion",
      action: "NOTION_CREATE_NOTION_PAGE",
      risk: "write",
      title: "Create Notion page: New page",
      payload: { parent_id: "parent123", title: "New page", markdown: "Content here" },
    })
    expect(result).toEqual({ id: "p1", status: "pending", message: "queued" })
  })

  it("gates an archive action as irreversible", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p2", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "notion",
      toolkit: NOTION_TOOLKIT,
      specs: notionComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    await tools["NOTION_ARCHIVE_NOTION_PAGE"]!.execute({
      page_id: "page123",
    })

    expect((create.mock.calls[0]![0] as Record<string, unknown>)["risk"]).toBe("irreversible")
  })
})

describe("Notion via Composio — approval replay", () => {
  it("on replay (no createPendingAction) a write runs the real executor", async () => {
    const executor = fakeExecutor({ id: "new-page-1", url: "https://notion.so/..." })
    const factory = createComposioTools({
      provider: "notion",
      toolkit: NOTION_TOOLKIT,
      specs: notionComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx())

    const result = await tools["NOTION_CREATE_NOTION_PAGE"]!.execute({
      parent_id: "parent123",
      title: "Approved page",
    })

    expect(result).toEqual({ id: "new-page-1", url: "https://notion.so/..." })
    expect(executor.calls).toEqual([
      {
        userId: "user_1",
        slug: "NOTION_CREATE_NOTION_PAGE",
        arguments: { parent_id: "parent123", title: "Approved page" },
      },
    ])
  })
})

describe("Notion via Composio — error handling", () => {
  it("returns a structured connector error with reconnect hint when the executor fails", async () => {
    const executor: ComposioExecutor = {
      execute: async () => {
        throw new Error("Composio execute → status 401 unauthorized")
      },
    }
    const factory = createComposioTools({
      provider: "notion",
      toolkit: NOTION_TOOLKIT,
      specs: notionComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx())

    const result = (await tools["NOTION_SEARCH_NOTION_PAGE"]!.execute({
      query: "test",
    })) as { error: string; hint?: string }

    expect(result.error).toContain("401")
    expect(result.hint).toContain("reconnect")
  })
})
