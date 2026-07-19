import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import { makeComposioDocsDef, docsComposioSpecs, DOCS_TOOLKIT } from "./google-docs.js"
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

describe("Docs via Composio — ConnectorDef shape", () => {
  it("produces a ConnectorDef with the correct id and category", () => {
    const def = makeComposioDocsDef(fakeExecutor())
    expect(def.id).toBe("google-docs")
    expect(def.name).toBe("Google Docs")
    expect(def.category).toBe("productivity")
    expect(def.auth).toEqual({
      kind: "composio",
      toolkit: DOCS_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_DOCS_AUTH_CONFIG_ID",
    })
  })

  it("exposes tools factory that returns tools keyed by Composio slug", () => {
    const def = makeComposioDocsDef(fakeExecutor())
    const tools = def.tools(buildCtx())
    expect(tools["GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN"]).toBeDefined()
    expect(tools["GOOGLEDOCS_GET_DOCUMENT_BY_ID"]).toBeDefined()
    expect(tools["GOOGLEDOCS_GET_CHARTS_FROM_SPREADSHEET"]).toBeDefined()
  })
})

describe("Docs via Composio — read pass-through", () => {
  it("executes a Docs read tool directly and returns the result", async () => {
    const executor = fakeExecutor({ documentId: "d1", title: "Notes" })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-docs",
      toolkit: DOCS_TOOLKIT,
      specs: docsComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GOOGLEDOCS_GET_DOCUMENT_BY_ID"]!.execute({ id: "d1" })

    expect(result).toEqual({ documentId: "d1", title: "Notes" })
    expect(executor.calls).toEqual([
      { userId: "user_1", slug: "GOOGLEDOCS_GET_DOCUMENT_BY_ID", arguments: { id: "d1" } },
    ])
    expect(create).not.toHaveBeenCalled()
  })

  it("treats the cross-connector Sheets chart reads as reads, not writes", async () => {
    const executor = fakeExecutor({ charts: [] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-docs",
      toolkit: DOCS_TOOLKIT,
      specs: docsComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    await tools["GOOGLEDOCS_LIST_SPREADSHEET_CHARTS_ACTION"]!.execute({ spreadsheet_id: "s1" })
    await tools["GOOGLEDOCS_GET_CHARTS_FROM_SPREADSHEET"]!.execute({ spreadsheet_id: "s1" })

    expect(create).not.toHaveBeenCalled()
    expect(executor.calls.length).toBe(2)
  })
})

describe("Docs via Composio — write gating", () => {
  it("routes markdown creation through createPendingAction", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-docs",
      toolkit: DOCS_TOOLKIT,
      specs: docsComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    await tools["GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN"]!.execute({
      title: "New Doc",
      markdown_text: "# Hello",
    })

    expect(executor.calls).toEqual([])
    const arg = create.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.risk).toBe("write")
  })
})

describe("Docs via Composio — approval replay", () => {
  it("on replay (no createPendingAction) a write runs the real executor", async () => {
    const executor = fakeExecutor({ documentId: "newdoc1" })
    const factory = createComposioTools({
      provider: "google-docs",
      toolkit: DOCS_TOOLKIT,
      specs: docsComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx())

    const result = await tools["GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN"]!.execute({
      title: "Report",
      markdown_text: "# Data",
    })

    expect(result).toEqual({ documentId: "newdoc1" })
  })
})
