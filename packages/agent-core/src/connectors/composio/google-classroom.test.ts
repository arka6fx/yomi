import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import {
  makeComposioClassroomDef,
  classroomComposioSpecs,
  CLASSROOM_TOOLKIT,
} from "./google-classroom.js"
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
    expect(tools["GOOGLE_CLASSROOM_COURSES_LIST"]).toBeDefined()
    expect(tools["GOOGLE_CLASSROOM_COURSE_WORK_LIST"]).toBeDefined()
    expect(tools["GOOGLE_CLASSROOM_COURSE_WORK_GET"]).toBeDefined()
    expect(tools["GOOGLE_CLASSROOM_COURSES_ANNOUNCEMENTS_LIST"]).toBeDefined()
    expect(tools["GOOGLE_CLASSROOM_COURSE_WORK_STUDENT_SUBMISSIONS_LIST"]).toBeDefined()
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

    const result = await tools["GOOGLE_CLASSROOM_COURSES_LIST"]!.execute({})

    expect(result).toEqual({ courses: [{ id: "c1", name: "Math 101" }] })
    expect(executor.calls).toEqual([
      { userId: "user_1", slug: "GOOGLE_CLASSROOM_COURSES_LIST", arguments: {} },
    ])
    expect(create).not.toHaveBeenCalled()
  })

  it("passes courseId through to a coursework read tool", async () => {
    const executor = fakeExecutor({ courseWork: [{ id: "cw1", title: "Homework 1" }] })
    const factory = createComposioTools({
      provider: "google-classroom",
      toolkit: CLASSROOM_TOOLKIT,
      specs: classroomComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx())

    const result = await tools["GOOGLE_CLASSROOM_COURSE_WORK_LIST"]!.execute({ courseId: "c1" })

    expect(result).toEqual({ courseWork: [{ id: "cw1", title: "Homework 1" }] })
    expect(executor.calls).toEqual([
      {
        userId: "user_1",
        slug: "GOOGLE_CLASSROOM_COURSE_WORK_LIST",
        arguments: { courseId: "c1" },
      },
    ])
  })
})
