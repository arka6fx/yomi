import { describe, expect, it } from "bun:test"
import { ConnectorRegistry } from "./registry.js"

// postgres/mysql are flagged requiresNodeRuntime; slack is not.
const connected = ["postgres", "mysql", "slack"]

function makeRegistry(excludeNodeOnly: boolean) {
  return new ConnectorRegistry({
    getAccessToken: async () => "token",
    listConnectedProviders: async () => connected,
    excludeNodeOnly,
  })
}

describe("ConnectorRegistry node-only gating", () => {
  it("includes Node-only DB connectors by default (sidecar path)", async () => {
    const reg = makeRegistry(false)
    await reg.init("user_1")
    const tools = reg.getAllDefTools()
    expect(tools["postgres-query"]).toBeDefined()
    expect(tools["mysql-query"]).toBeDefined()
    expect(reg.isConnected("postgres")).toBe(true)
  })

  it("excludes Node-only DB connectors when excludeNodeOnly is set (Workers path)", async () => {
    const reg = makeRegistry(true)
    await reg.init("user_1")
    const tools = reg.getAllDefTools()
    expect(tools["postgres-query"]).toBeUndefined()
    expect(tools["mysql-query"]).toBeUndefined()
    expect(reg.isConnected("postgres")).toBe(false)
    expect(reg.isConnected("mysql")).toBe(false)
  })

  it("keeps Workers-compatible connectors when excludeNodeOnly is set", async () => {
    const reg = makeRegistry(true)
    await reg.init("user_1")
    expect(reg.isConnected("slack")).toBe(true)
  })

  it("reports skipped connected Node-only connectors as desktop-only", async () => {
    const reg = makeRegistry(true)
    await reg.init("user_1")
    expect(reg.getDesktopOnlyConnected().sort()).toEqual(["MySQL", "PostgreSQL"])
  })

  it("reports nothing as desktop-only when excludeNodeOnly is off", async () => {
    const reg = makeRegistry(false)
    await reg.init("user_1")
    expect(reg.getDesktopOnlyConnected()).toEqual([])
  })
})
