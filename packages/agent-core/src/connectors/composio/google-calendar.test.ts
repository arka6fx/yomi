import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import { makeComposioCalendarDef, calendarComposioSpecs, CALENDAR_TOOLKIT } from "./google-calendar.js"
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

describe("Calendar via Composio — ConnectorDef shape", () => {
  it("produces a ConnectorDef with the correct id and category", () => {
    const def = makeComposioCalendarDef(fakeExecutor())
    expect(def.id).toBe("google-calendar")
    expect(def.name).toBe("Google Calendar")
    expect(def.category).toBe("productivity")
    expect(def.auth).toEqual({
      kind: "composio",
      toolkit: CALENDAR_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_CALENDAR_AUTH_CONFIG_ID",
    })
  })

  it("exposes tools factory that returns tools keyed by Composio slug", () => {
    const def = makeComposioCalendarDef(fakeExecutor())
    const tools = def.tools(buildCtx())
    expect(tools["GOOGLECALENDAR_EVENTS_LIST"]).toBeDefined()
    expect(tools["GOOGLECALENDAR_CREATE_EVENT"]).toBeDefined()
    expect(tools["GOOGLECALENDAR_DELETE_EVENT"]).toBeDefined()
  })
})

describe("Calendar via Composio — read pass-through", () => {
  it("executes a Calendar read tool directly and returns the result", async () => {
    const executor = fakeExecutor({ events: [{ id: "e1", summary: "Standup" }] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-calendar",
      toolkit: CALENDAR_TOOLKIT,
      specs: calendarComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GOOGLECALENDAR_EVENTS_LIST"]!.execute({ calendarId: "primary", maxResults: 10 })

    expect(result).toEqual({ events: [{ id: "e1", summary: "Standup" }] })
    expect(executor.calls).toEqual([
      { userId: "user_1", slug: "GOOGLECALENDAR_EVENTS_LIST", arguments: { calendarId: "primary", maxResults: 10 } },
    ])
    expect(create).not.toHaveBeenCalled()
  })
})

describe("Calendar via Composio — write gating", () => {
  it("routes a createEvent write tool through createPendingAction", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-calendar",
      toolkit: CALENDAR_TOOLKIT,
      specs: calendarComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    await tools["GOOGLECALENDAR_CREATE_EVENT"]!.execute({
      summary: "Team standup",
      start_datetime: "2026-07-20T09:00:00",
      event_duration_minutes: 30,
    })

    expect(executor.calls).toEqual([])
    const arg = create.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.risk).toBe("write")
  })
})

describe("Calendar via Composio — approval replay", () => {
  it("on replay (no createPendingAction) a write runs the real executor", async () => {
    const executor = fakeExecutor({ ok: true, id: "evt_1", htmlLink: "https://calendar.google.com/..." })
    const factory = createComposioTools({
      provider: "google-calendar",
      toolkit: CALENDAR_TOOLKIT,
      specs: calendarComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx())

    const result = await tools["GOOGLECALENDAR_CREATE_EVENT"]!.execute({
      summary: "Meeting",
      start_datetime: "2026-07-20T10:00:00",
      event_duration_hour: 1,
    })

    expect(result).toEqual({ ok: true, id: "evt_1", htmlLink: "https://calendar.google.com/..." })
  })
})
