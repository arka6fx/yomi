import { describe, expect, it, mock } from "bun:test"
import type { ConnectorContext } from "../connector-def.js"
import { makeComposioMapsDef, mapsComposioSpecs, MAPS_TOOLKIT } from "./google-maps.js"
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

describe("Google Maps via Composio — ConnectorDef shape", () => {
  it("produces a ConnectorDef with the correct id, category, and read-only default", () => {
    const def = makeComposioMapsDef(fakeExecutor())
    expect(def.id).toBe("google-maps")
    expect(def.name).toBe("Google Maps")
    expect(def.category).toBe("productivity")
    expect(def.readOnlyByDefault).toBe(true)
    expect(def.auth).toEqual({
      kind: "composio",
      toolkit: MAPS_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_MAPS_AUTH_CONFIG_ID",
    })
  })

  it("exposes exactly the 2 live-verified tools, keyed by Composio slug", () => {
    const def = makeComposioMapsDef(fakeExecutor())
    const tools = def.tools(buildCtx())
    expect(tools["GOOGLE_MAPS_NEARBY_SEARCH"]).toBeDefined()
    expect(tools["GOOGLE_MAPS_TEXT_SEARCH"]).toBeDefined()
    expect(Object.keys(tools)).toHaveLength(2)
  })
})

describe("Google Maps via Composio — read pass-through", () => {
  it("executes nearby search directly and returns the result, with no approval gating", async () => {
    const executor = fakeExecutor({ places: [{ displayName: { text: "Blue Tokai Coffee" } }] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-maps",
      toolkit: MAPS_TOOLKIT,
      specs: mapsComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GOOGLE_MAPS_NEARBY_SEARCH"]!.execute({
      latitude: 12.9716,
      longitude: 77.5946,
      radius: 500,
    })

    expect(result).toEqual({ places: [{ displayName: { text: "Blue Tokai Coffee" } }] })
    expect(executor.calls).toEqual([
      {
        userId: "user_1",
        slug: "GOOGLE_MAPS_NEARBY_SEARCH",
        arguments: { latitude: 12.9716, longitude: 77.5946, radius: 500 },
      },
    ])
    expect(create).not.toHaveBeenCalled()
  })

  it("executes text search directly and returns the result, with no approval gating", async () => {
    const executor = fakeExecutor({ places: [{ displayName: { text: "Third Wave Coffee" } }] })
    const create = mock(async () => ({ id: "p1", status: "pending", message: "queued" }))
    const factory = createComposioTools({
      provider: "google-maps",
      toolkit: MAPS_TOOLKIT,
      specs: mapsComposioSpecs,
      executor,
    })
    const tools = factory(buildCtx({ createPendingAction: create }))

    const result = await tools["GOOGLE_MAPS_TEXT_SEARCH"]!.execute({
      textQuery: "coffee shop near Koramangala",
    })

    expect(result).toEqual({ places: [{ displayName: { text: "Third Wave Coffee" } }] })
    expect(create).not.toHaveBeenCalled()
  })
})
