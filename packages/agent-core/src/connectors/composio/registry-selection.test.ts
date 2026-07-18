import { afterEach, describe, expect, it } from "bun:test"
import { ConnectorRegistry } from "../registry.js"
import { makeComposioLinearDef } from "./linear.js"
import type { ComposioExecutor } from "./adapter.js"

// A composio def whose tools are tagged so we can tell them apart from native.
function taggedComposioLinearDef() {
  const executor: ComposioExecutor = { execute: async () => ({ ok: true }) }
  return makeComposioLinearDef(executor)
}

function makeRegistry(useComposio: boolean) {
  return new ConnectorRegistry({
    getAccessToken: async () => "token",
    listConnectedProviders: async () => ["linear"],
    composioDefs: useComposio ? { linear: taggedComposioLinearDef() } : undefined,
  })
}

const origFlag = process.env["COMPOSIO_CONNECTORS"]
afterEach(() => {
  if (origFlag === undefined) delete process.env["COMPOSIO_CONNECTORS"]
  else process.env["COMPOSIO_CONNECTORS"] = origFlag
})

describe("ConnectorRegistry native↔composio selection", () => {
  it("keeps native Linear tools when the flag is off, even if a composio def is injected", async () => {
    delete process.env["COMPOSIO_CONNECTORS"]
    const reg = makeRegistry(true)
    await reg.init("user_1")
    const tools = reg.getAllDefTools()
    // native Linear exposes hyphenated tool keys like "linear-listIssues"
    expect(Object.keys(tools)).toContain("linear-listIssues")
    expect(Object.keys(tools)).not.toContain("LINEAR_LIST_LINEAR_ISSUES")
  })

  it("swaps to composio Linear tools when the flag lists the connector", async () => {
    process.env["COMPOSIO_CONNECTORS"] = "linear"
    const reg = makeRegistry(true)
    await reg.init("user_1")
    const tools = reg.getAllDefTools()
    // composio exposes Composio slugs as tool keys
    expect(Object.keys(tools)).toContain("LINEAR_LIST_LINEAR_ISSUES")
    expect(Object.keys(tools)).not.toContain("linear-listIssues")
  })

  it("keeps native when flagged but no composio def is injected (native retained)", async () => {
    process.env["COMPOSIO_CONNECTORS"] = "linear"
    const reg = makeRegistry(false)
    await reg.init("user_1")
    const tools = reg.getAllDefTools()
    expect(Object.keys(tools)).toContain("linear-listIssues")
  })
})
