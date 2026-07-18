import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import { makeComposioClassroomDef, classroomComposioSpecs, CLASSROOM_TOOLKIT } from "./google-classroom.js"
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

describe("Classroom via Composio — ConnectorDef shape", () => {
  it("produces a ConnectorDef with the correct id and category", () => {
    const def = makeComposioClassroomDef(fakeExecutor())
    expect(def.id).toBe("google-classroom")
    expect(def.name).toBe("Google Classroom")
    expect(def.category).toBe("productivity")
    expect(def.auth).toEqual({
      kind: "composio",
      toolkit: CLASSROOM_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_CLASSROOM_AUTH_CONFIG_ID",
    })
  })

  it("exposes tools factory that returns tools keyed by Composio slug", () => {
    const def = makeComposioClassroomDef(fakeExecutor())
    const tools = def.tools(buildCtx())
    expect(tools["GOOGLECLASSROOM_LIST_COURSES"]).toBeDefined()
    expect(tools["GOOGLECLASSROOM_TURN_IN"]).toBeDefined()
    expect(tools["GOOGLECLASSROOM_ATTACH_FILE"]).toBeDefined()
  })
})

describe("Classroom via Composio — read pass-through", () => {
  it("executes a Classroom read tool directly and returns the result", async () => {
    const executor = fakeExecutor({ courses: [{ id: "c1", name: "Math 101" }] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-classroom",
      toolkit: CLASSROOM_TOOLKIT,
      specs: classroomComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GOOGLECLASSROOM_LIST_COURSES"]!.execute({})

    expect(result).toEqual({ courses: [{ id: "c1", name: "Math 101" }] })
    expect(executor.calls).toEqual([
      { userId: "user_1", slug: "GOOGLECLASSROOM_LIST_COURSES", arguments: {} },
    ])
    expect(create).not.toHaveBeenCalled()
  })
})

describe("Classroom via Composio — write gating", () => {
  it("routes a createCourse write tool through createPendingAction", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-classroom",
      toolkit: CLASSROOM_TOOLKIT,
      specs: classroomComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    await tools["GOOGLECLASSROOM_TURN_IN"]!.execute({ course_id: "c1", course_work_id: "cw1" })

    expect(executor.calls).toEqual([])
    const arg = create.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.risk).toBe("write")
  })
})
