import { describe, expect, it, mock } from "bun:test"

// Test URLs use literal public IPs (8.8.8.8 / 1.1.1.1), not hostnames like
// mcp.example.com — resolvesToDisallowedAddress (the real, unmocked SSRF
// guard) skips DNS entirely for literal IPs, so these tests exercise it for
// real without needing to mock it or "node:dns". Mocking ./ssrf-guard.js
// itself was tried and reverted: bun test in this repo doesn't isolate
// module mocks per file (no --isolate in the package's test script), so a
// whole-module mock here silently won for the rest of the process and broke
// ssrf-guard.test.ts's own tests for the same function.
mock.module("./mcp-connector.js", () => ({
  createMCPToolProvider: () => ({
    loadTools: async ({ servers }: { servers: { id: string; url: string }[] }) => {
      if (servers[0]?.url === "https://1.1.1.1/mcp") {
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
        { id: "srv1", name: "My Server", url: "https://8.8.8.8", apiKey: null },
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
        { id: "broken", name: "Broken", url: "https://1.1.1.1/mcp", apiKey: null },
      ],
    })
    await reg.init("user_1")
    await reg.loadMCPTools()
    const tools = reg.getAllDefTools()
    expect(Object.keys(tools).some((k) => k.startsWith("tool_from_"))).toBe(false)
    expect(Object.keys(tools).length).toBeGreaterThan(0) // slack's own tools still loaded
  })

  it("does not connect a custom server whose address resolves to disallowed infrastructure", async () => {
    const reg = new ConnectorRegistry({
      getAccessToken: async () => "token",
      listConnectedProviders: async () => [],
      listCustomMcpServers: async () => [
        { id: "ssrf", name: "Metadata probe", url: "https://169.254.169.254/", apiKey: null },
      ],
    })
    await reg.init("user_1")
    await reg.loadMCPTools()
    expect(reg.getAllDefTools()).toEqual({})
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
