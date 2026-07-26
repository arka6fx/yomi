import { describe, expect, it } from "bun:test"
import { figmaComposioSpecs } from "./figma.js"

describe("figmaComposioSpecs", () => {
  // Confirmed live (GET /api/v3/tools?tool_slugs=FIGMA_CREATE_DEV_RESOURCES): the
  // schema is a `dev_resources` array of { name, url, file_key, node_id }, each
  // required (up to 10 per node) — Yomi's flat file_key/node_ids shape has no way
  // to express a URL at all, so the tool could never satisfy the real schema.
  it("FIGMA_CREATE_DEV_RESOURCES requires a dev_resources array with url per item", () => {
    const spec = figmaComposioSpecs.find((s) => s.slug === "FIGMA_CREATE_DEV_RESOURCES")!

    expect(spec.parameters.safeParse({ file_key: "abc", node_ids: ["1:2"] }).success).toBe(false)
    expect(
      spec.parameters.safeParse({
        dev_resources: [{ name: "Jira Ticket", url: "https://jira.example.com/T-1", file_key: "abc", node_id: "1:2" }],
      }).success,
    ).toBe(true)
  })
})
