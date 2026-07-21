import { describe, expect, it, mock } from "bun:test"

mock.module("./mcp-connector.js", () => ({
  createMCPToolProvider: () => ({
    loadTools: async ({ servers }: { servers: { id: string; url: string }[] }) => {
      if (servers[0]?.url === "https://broken.example.com/mcp") {
        throw new Error("connection refused")
      }
      return {
        [`tool_from_${servers[0]?.id}`]: {
          description: "fake",
          parameters: {},
          execute: async () => "ok",
        },
      }
    },
    close: async () => {},
  }),
}))

const { ConnectorRegistry } = await import("./registry.js")

describe("ConnectorRegistry custom MCP servers", () => {
  it("merges tools from a user's custom MCP servers into getAllDefTools", async () => {
    const reg = new ConnectorRegistry({
      getAccessToken: async () => "token",
      listConnectedProviders: async () => [],
      listCustomMcpServers: async () => [
        { id: "srv1", name: "My Server", url: "https://mcp.example.com", apiKey: null },
      ],
    })
    await reg.init("user_1")
    await reg.loadMCPTools()
    expect(Object.keys(reg.getAllDefTools())).toContain("tool_from_srv1")
  })

  it("does not affect built-in def tools when a custom server fails to connect", async () => {
    const reg = new ConnectorRegistry({
      getAccessToken: async () => "token",
      listConnectedProviders: async () => ["slack"],
      listCustomMcpServers: async () => [
        { id: "broken", name: "Broken", url: "https://broken.example.com/mcp", apiKey: null },
      ],
    })
    await reg.init("user_1")
    await reg.loadMCPTools()
    const tools = reg.getAllDefTools()
    expect(Object.keys(tools).some((k) => k.startsWith("tool_from_"))).toBe(false)
    expect(Object.keys(tools).length).toBeGreaterThan(0) // slack's own tools still loaded
  })

  it("does nothing when listCustomMcpServers is not provided", async () => {
    const reg = new ConnectorRegistry({
      getAccessToken: async () => "token",
      listConnectedProviders: async () => [],
    })
    await reg.init("user_1")
    await reg.loadMCPTools()
    expect(reg.getAllDefTools()).toEqual({})
  })
})
