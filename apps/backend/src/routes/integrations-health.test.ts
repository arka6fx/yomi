import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test"

// Composio-backed rows store only a connection reference (no real access token —
// see composio-connect.ts), so decryptTokens().accessToken comes back undefined
// for them. This mock reproduces exactly that: any provider health check that
// tries to use it as a bearer token gets `undefined`, same as prod.
mock.module("../services/integration-tokens.js", () => ({
  getAccessToken: async () => undefined,
}))

let checkProviderHealth: typeof import("./integrations.js").checkProviderHealth
let registerConnectorDef: typeof import("../connectors/registry.js").registerConnectorDef

beforeAll(async () => {
  ;({ checkProviderHealth } = await import("./integrations.js"))
  ;({ registerConnectorDef } = await import("../connectors/registry.js"))
})

afterEach(() => {
  mock.restore()
})

describe("checkProviderHealth — composio-backed connectors", () => {
  it("reports healthy without probing the provider API (no real token to send)", async () => {
    registerConnectorDef({
      id: "google-calendar-health-test",
      auth: { kind: "composio", toolkit: "googlecalendar" },
    } as import("../connectors/types.js").BackendConnectorDef)

    let fetchCalled = false
    global.fetch = mock(async () => {
      fetchCalled = true
      return new Response("Unauthorized", { status: 401 })
    })

    const result = await checkProviderHealth("user-1", "google-calendar-health-test")

    expect(result.ok).toBe(true)
    expect(fetchCalled).toBe(false)
  })

  it("still flags a real 401 for native (non-composio) connectors", async () => {
    registerConnectorDef({
      id: "google-native-health-test",
      auth: { kind: "oauth2" },
    } as import("../connectors/types.js").BackendConnectorDef)

    global.fetch = mock(async () => new Response("Unauthorized", { status: 401 }))

    const result = await checkProviderHealth("user-1", "google-native-health-test")

    expect(result.ok).toBe(false)
    expect(result.message).toInclude("401")
  })
})
