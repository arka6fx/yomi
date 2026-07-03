import { describe, expect, it } from "bun:test"
import { ConnectorRegistry } from "./registry.js"

const connected = ["slack"]

function makeRegistry(excludeNodeOnly: boolean) {
  return new ConnectorRegistry({
    getAccessToken: async () => "token",
    listConnectedProviders: async () => connected,
    excludeNodeOnly,
  })
}

describe("ConnectorRegistry node-only gating", () => {
  it("keeps non-Node-only connectors regardless of excludeNodeOnly", async () => {
    const reg = makeRegistry(true)
    await reg.init("user_1")
    expect(reg.isConnected("slack")).toBe(true)
  })

  it("reports nothing as desktop-only when no Node-only connectors connected", async () => {
    const reg = makeRegistry(true)
    await reg.init("user_1")
    expect(reg.getDesktopOnlyConnected()).toEqual([])
  })

  it("does not affect connectors when excludeNodeOnly is off", async () => {
    const reg = makeRegistry(false)
    await reg.init("user_1")
    expect(reg.isConnected("slack")).toBe(true)
  })
})
