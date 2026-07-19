import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import { makeComposioSheetsDef, sheetsComposioSpecs, SHEETS_TOOLKIT } from "./google-sheets.js"
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

describe("Sheets via Composio — ConnectorDef shape", () => {
  it("produces a ConnectorDef with the correct id and category", () => {
    const def = makeComposioSheetsDef(fakeExecutor())
    expect(def.id).toBe("google-sheets")
    expect(def.name).toBe("Google Sheets")
    expect(def.category).toBe("productivity")
    expect(def.auth).toEqual({
      kind: "composio",
      toolkit: SHEETS_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_SHEETS_AUTH_CONFIG_ID",
    })
  })

  it("exposes tools factory that returns tools keyed by Composio slug", () => {
    const def = makeComposioSheetsDef(fakeExecutor())
    const tools = def.tools(buildCtx())
    expect(tools["GOOGLESHEETS_GET_SPREADSHEET_INFO"]).toBeDefined()
    expect(tools["GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND"]).toBeDefined()
    expect(tools["GOOGLESHEETS_DELETE_SHEET"]).toBeDefined()
  })
})

describe("Sheets via Composio — read pass-through", () => {
  it("executes a Sheets read tool directly and returns the result", async () => {
    const executor = fakeExecutor({ values: [["a", "b"]] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-sheets",
      toolkit: SHEETS_TOOLKIT,
      specs: sheetsComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GOOGLESHEETS_BATCH_GET"]!.execute({ spreadsheet_id: "s1" })

    expect(result).toEqual({ values: [["a", "b"]] })
    expect(executor.calls).toEqual([
      { userId: "user_1", slug: "GOOGLESHEETS_BATCH_GET", arguments: { spreadsheet_id: "s1" } },
    ])
    expect(create).not.toHaveBeenCalled()
  })
})

describe("Sheets via Composio — write gating", () => {
  it("routes an append-rows write tool through createPendingAction", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-sheets",
      toolkit: SHEETS_TOOLKIT,
      specs: sheetsComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    await tools["GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND"]!.execute({
      spreadsheetId: "s1",
      range: "Sheet1!A1:B2",
      values: [["1", "2"]],
      valueInputOption: "RAW",
    })

    expect(executor.calls).toEqual([])
    const arg = create.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.risk).toBe("write")
  })

  it("gates deleting a sheet tab as irreversible", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p2", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-sheets",
      toolkit: SHEETS_TOOLKIT,
      specs: sheetsComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    await tools["GOOGLESHEETS_DELETE_SHEET"]!.execute({ spreadsheetId: "s1", sheet_id: 123 })

    expect((create.mock.calls[0]![0] as Record<string, unknown>)["risk"]).toBe("irreversible")
  })
})

describe("Sheets via Composio — approval replay", () => {
  it("on replay (no createPendingAction) a write runs the real executor", async () => {
    const executor = fakeExecutor({ ok: true, updatedRange: "Sheet1!A2:B2" })
    const factory = createComposioTools({
      provider: "google-sheets",
      toolkit: SHEETS_TOOLKIT,
      specs: sheetsComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx())

    const result = await tools["GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND"]!.execute({
      spreadsheetId: "s1",
      range: "Sheet1!A1:B2",
      values: [["1", "2"]],
      valueInputOption: "RAW",
    })

    expect(result).toEqual({ ok: true, updatedRange: "Sheet1!A2:B2" })
  })
})
