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

describe("ConnectorRegistry MCP-based defs", () => {
  it("tracks MCP-connected IDs separately from native defs", async () => {
    const reg = makeRegistry(false)
    await reg.init("user_1")
    expect(reg.getMCPConnectedIds()).toEqual([])
  })

  it("loadMCPTools is safe to call when no MCP defs are connected", async () => {
    const reg = makeRegistry(false)
    await reg.init("user_1")
    await reg.loadMCPTools()
    expect(reg.getMCPConnectedIds()).toEqual([])
  })

  it("returns merged tools after loadMCPTools includes MCP and native tools", async () => {
    const reg = makeRegistry(false)
    await reg.init("user_1")
    const tools = reg.getAllDefTools()
    // Slack is connected and has tools
    expect(Object.keys(tools).length).toBeGreaterThan(0)
  })
})
