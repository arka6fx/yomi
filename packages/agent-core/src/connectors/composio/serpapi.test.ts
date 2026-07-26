import { describe, expect, it } from "bun:test"
import { serpapiComposioSpecs } from "./serpapi.js"

describe("serpapiComposioSpecs", () => {
  // Confirmed live (GET /api/v3/tools?tool_slugs=SERPAPI_WALMART_SEARCH): the
  // required field is `q`, not `query` — every call under the old schema would
  // fail Composio-side validation since the model always sent the wrong key.
  it("SERPAPI_WALMART_SEARCH requires q, not query", () => {
    const spec = serpapiComposioSpecs.find((s) => s.slug === "SERPAPI_WALMART_SEARCH")!

    expect(spec.parameters.safeParse({ query: "coffee maker" }).success).toBe(false)
    expect(spec.parameters.safeParse({ q: "coffee maker" }).success).toBe(true)
  })
})
