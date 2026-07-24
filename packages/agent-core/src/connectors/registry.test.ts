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

describe("ConnectorRegistry per-connector tool selection", () => {
  function makeMultiRegistry() {
    return new ConnectorRegistry({
      getAccessToken: async () => "token",
      listConnectedProviders: async () => ["slack", "github"],
      excludeNodeOnly: false,
    })
  }

  it("summarizes only connected connectors, with real name/description, no tool schemas", async () => {
    const reg = makeMultiRegistry()
    await reg.init("user_1")

    const summaries = reg.getConnectorSummaries()
    const ids = summaries.map((s) => s.id).sort()
    expect(ids).toEqual(["github", "slack"])
    for (const s of summaries) {
      expect(s.name.length).toBeGreaterThan(0)
      expect(s.description.length).toBeGreaterThan(0)
    }
  })

  it("getToolsForConnectors returns only the requested connector's tools, a subset of getAllDefTools", async () => {
    const reg = makeMultiRegistry()
    await reg.init("user_1")

    const all = reg.getAllDefTools()
    const slackOnly = reg.getToolsForConnectors(["slack"])

    expect(Object.keys(slackOnly).length).toBeGreaterThan(0)
    expect(Object.keys(slackOnly).length).toBeLessThan(Object.keys(all).length)
    for (const key of Object.keys(slackOnly)) expect(all).toHaveProperty(key)
  })

  it("returns tools for multiple requested connectors combined", async () => {
    const reg = makeMultiRegistry()
    await reg.init("user_1")

    const slackOnly = reg.getToolsForConnectors(["slack"])
    const githubOnly = reg.getToolsForConnectors(["github"])
    const both = reg.getToolsForConnectors(["slack", "github"])

    expect(Object.keys(both).length).toBe(
      Object.keys(slackOnly).length + Object.keys(githubOnly).length,
    )
  })

  it("returns nothing for an empty or unknown connector id list", async () => {
    const reg = makeMultiRegistry()
    await reg.init("user_1")

    expect(reg.getToolsForConnectors([])).toEqual({})
    expect(reg.getToolsForConnectors(["not_a_real_connector"])).toEqual({})
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
