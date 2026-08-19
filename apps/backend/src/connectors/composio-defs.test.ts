import { describe, expect, it } from "bun:test"
import type { ComposioExecutor, ComposioToolSpec } from "@yomi/agent-core"
import { buildComposioDefs } from "./composio-defs.js"

function fakeExecutor(): ComposioExecutor {
  return { execute: async () => ({ ok: true }) }
}

// A catalog entry for a tool that was never hand-vetted for Maps — mirrors what
// loadComposioCatalog() would hand buildComposioDefs() straight from Composio's
// live catalog, unfiltered.
const unvettedMapsCatalogSpec: ComposioToolSpec = {
  slug: "GOOGLE_MAPS_COMPUTE_ROUTE_MATRIX",
  description:
    "Calculates travel distance and duration matrix between multiple origins/destinations.",
  parameters: { safeParse: () => ({ success: true, data: {} }) } as ComposioToolSpec["parameters"],
}

// Same shape but for a toolkit (Linear) that has NOT opted out of the catalog
// merge — this is the existing, desired "additive" behavior and must keep working.
const extraLinearCatalogSpec: ComposioToolSpec = {
  slug: "LINEAR_ARCHIVE_ISSUE",
  description: "Archive a Linear issue.",
  parameters: { safeParse: () => ({ success: true, data: {} }) } as ComposioToolSpec["parameters"],
}

describe("buildComposioDefs — catalog merge respects per-connector opt-out", () => {
  it("does not merge unvetted catalog tools into google-maps", () => {
    const defs = buildComposioDefs(fakeExecutor(), [unvettedMapsCatalogSpec])
    const tools = defs["google-maps"]!.tools({
      userId: "u1",
      getAccessToken: async () => "",
    })
    expect(Object.keys(tools)).toEqual(["GOOGLE_MAPS_NEARBY_SEARCH", "GOOGLE_MAPS_TEXT_SEARCH"])
    expect(tools["GOOGLE_MAPS_COMPUTE_ROUTE_MATRIX"]).toBeUndefined()
  })

  it("still merges catalog extras into connectors that haven't opted out", () => {
    const defs = buildComposioDefs(fakeExecutor(), [extraLinearCatalogSpec])
    const tools = defs["linear"]!.tools({
      userId: "u1",
      getAccessToken: async () => "",
    })
    expect(tools["LINEAR_ARCHIVE_ISSUE"]).toBeDefined()
  })
})
