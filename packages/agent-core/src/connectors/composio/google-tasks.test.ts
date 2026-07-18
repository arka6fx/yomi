import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import { makeComposioTasksDef, tasksComposioSpecs, TASKS_TOOLKIT } from "./google-tasks.js"
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

describe("Tasks via Composio — ConnectorDef shape", () => {
  it("produces a ConnectorDef with the correct id and category", () => {
    const def = makeComposioTasksDef(fakeExecutor())
    expect(def.id).toBe("google-tasks")
    expect(def.name).toBe("Google Tasks")
    expect(def.category).toBe("productivity")
    expect(def.auth).toEqual({
      kind: "composio",
      toolkit: TASKS_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_TASKS_AUTH_CONFIG_ID",
    })
  })

  it("exposes tools factory that returns tools keyed by Composio slug", () => {
    const def = makeComposioTasksDef(fakeExecutor())
    const tools = def.tools(buildCtx())
    expect(tools["GOOGLETASKS_LIST_TASKS"]).toBeDefined()
    expect(tools["GOOGLETASKS_CREATE_TASK"]).toBeDefined()
    expect(tools["GOOGLETASKS_DELETE_TASK"]).toBeDefined()
  })
})

describe("Tasks via Composio — read pass-through", () => {
  it("executes a Tasks read tool directly and returns the result", async () => {
    const executor = fakeExecutor({ tasks: [{ id: "t1", title: "Buy milk" }] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-tasks",
      toolkit: TASKS_TOOLKIT,
      specs: tasksComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GOOGLETASKS_LIST_TASKS"]!.execute({ tasklist_id: "tl1" })

    expect(result).toEqual({ tasks: [{ id: "t1", title: "Buy milk" }] })
    expect(executor.calls).toEqual([
      { userId: "user_1", slug: "GOOGLETASKS_LIST_TASKS", arguments: { tasklist_id: "tl1" } },
    ])
    expect(create).not.toHaveBeenCalled()
  })
})

describe("Tasks via Composio — write gating", () => {
  it("routes a createTask write tool through createPendingAction", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-tasks",
      toolkit: TASKS_TOOLKIT,
      specs: tasksComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    await tools["GOOGLETASKS_CREATE_TASK"]!.execute({ tasklist_id: "tl1", title: "Buy milk" })

    expect(executor.calls).toEqual([])
    const arg = create.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.risk).toBe("write")
  })
})
