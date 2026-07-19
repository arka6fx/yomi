import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import { makeComposioMeetDef, meetComposioSpecs, MEET_TOOLKIT } from "./google-meet.js"
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

describe("Meet via Composio — ConnectorDef shape", () => {
  it("produces a ConnectorDef with the correct id and category", () => {
    const def = makeComposioMeetDef(fakeExecutor())
    expect(def.id).toBe("google-meet")
    expect(def.name).toBe("Google Meet")
    expect(def.category).toBe("meetings")
    expect(def.auth).toEqual({
      kind: "composio",
      toolkit: MEET_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_MEET_AUTH_CONFIG_ID",
    })
  })

  it("exposes tools factory that returns tools keyed by Composio slug", () => {
    const def = makeComposioMeetDef(fakeExecutor())
    const tools = def.tools(buildCtx())
    expect(tools["GOOGLEMEET_CREATE_MEET"]).toBeDefined()
    expect(tools["GOOGLEMEET_GET_MEET"]).toBeDefined()
  })
})

describe("Meet via Composio — read pass-through", () => {
  it("executes a Meet read tool directly and returns the result", async () => {
    const executor = fakeExecutor({ space: { name: "spaces/abc123", meetingUri: "https://meet.google.com/abc-def-ghi" } })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-meet",
      toolkit: MEET_TOOLKIT,
      specs: meetComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GOOGLEMEET_GET_MEET"]!.execute({ space_name: "spaces/abc123" })

    expect(result).toEqual({ space: { name: "spaces/abc123", meetingUri: "https://meet.google.com/abc-def-ghi" } })
    expect(executor.calls).toEqual([
      { userId: "user_1", slug: "GOOGLEMEET_GET_MEET", arguments: { space_name: "spaces/abc123" } },
    ])
    expect(create).not.toHaveBeenCalled()
  })
})

describe("Meet via Composio — write gating", () => {
  it("routes a createSpace write tool through createPendingAction", async () => {
    const executor = fakeExecutor()
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-meet",
      toolkit: MEET_TOOLKIT,
      specs: meetComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    await tools["GOOGLEMEET_CREATE_MEET"]!.execute({ access_type: "TRUSTED" })

    expect(executor.calls).toEqual([])
    const arg = create.mock.calls[0]![0] as Record<string, unknown>
    expect(arg.risk).toBe("write")
  })
})
