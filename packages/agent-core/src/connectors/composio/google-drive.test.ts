import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import { makeComposioDriveDef, driveComposioSpecs, DRIVE_TOOLKIT } from "./google-drive.js"
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

describe("Drive via Composio — ConnectorDef shape", () => {
  it("produces a ConnectorDef with the correct id and category", () => {
    const def = makeComposioDriveDef(fakeExecutor())
    expect(def.id).toBe("google-drive")
    expect(def.name).toBe("Google Drive")
    expect(def.category).toBe("productivity")
    expect(def.auth).toEqual({
      kind: "composio",
      toolkit: DRIVE_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_DRIVE_AUTH_CONFIG_ID",
    })
  })

  it("exposes tools factory that returns tools keyed by Composio slug", () => {
    const def = makeComposioDriveDef(fakeExecutor())
    const tools = def.tools(buildCtx())
    expect(tools["GOOGLEDRIVE_SEARCH_FILES"]).toBeDefined()
    expect(tools["GOOGLEDRIVE_CREATE_FILE"]).toBeDefined()
    expect(tools["GOOGLEDRIVE_DELETE_FILE"]).toBeDefined()
  })
})

describe("Drive via Composio — read pass-through", () => {
  it("executes a Drive read tool directly and returns the result", async () => {
    const executor = fakeExecutor({ files: [{ id: "f1", name: "Notes" }] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-drive",
      toolkit: DRIVE_TOOLKIT,
      specs: driveComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GOOGLEDRIVE_LIST_FILES"]!.execute({ page_size: 5 })

    expect(result).toEqual({ files: [{ id: "f1", name: "Notes" }] })
    expect(executor.calls).toEqual([
      { userId: "user_1", slug: "GOOGLEDRIVE_LIST_FILES", arguments: { page_size: 5 } },
    ])
    expect(create).not.toHaveBeenCalled()
  })
})

describe("Drive via Composio — write gating", () => {
  it("routes a createFile write tool through createPendingAction", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-drive",
      toolkit: DRIVE_TOOLKIT,
      specs: driveComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    await tools["GOOGLEDRIVE_CREATE_FILE"]!.execute({ name: "New Doc", content: "Hello" })

    expect(executor.calls).toEqual([])
    const arg = create.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.risk).toBe("write")
  })

  it("gates a delete action as irreversible", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p2", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-drive",
      toolkit: DRIVE_TOOLKIT,
      specs: driveComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    await tools["GOOGLEDRIVE_DELETE_FILE"]!.execute({ file_id: "f1", permanent: true })

    expect((create.mock.calls[0]![0] as Record<string, unknown>)["risk"]).toBe("irreversible")
  })
})

describe("Drive via Composio — approval replay", () => {
  it("on replay (no createPendingAction) a write runs the real executor", async () => {
    const executor = fakeExecutor({ ok: true, id: "newfile1" })
    const factory = createComposioTools({
      provider: "google-drive",
      toolkit: DRIVE_TOOLKIT,
      specs: driveComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx())

    const result = await tools["GOOGLEDRIVE_CREATE_FILE"]!.execute({
      name: "Report",
      content: "Data",
    })

    expect(result).toEqual({ ok: true, id: "newfile1" })
  })
})
