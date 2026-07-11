import { describe, expect, it } from "bun:test"
import { ALL_CONNECTOR_DEFS } from "@yomi/agent-core"
// Importing the defs barrel is what registers every connector with the backend.
import "./defs/index.js"
import { getConnectorDef, getAllConnectorDefs } from "./registry.js"

describe("backend connector registry", () => {
  // The backend keeps its own registry, populated by a per-connector file under
  // defs/. Adding a def to agent-core's ALL_CONNECTOR_DEFS is NOT enough — miss
  // the backend file and /api/integrations/connect/:id 404s with
  // "Unknown connector", which is exactly how google-tasks/contacts/meet shipped
  // unconnectable. This test makes that impossible to repeat.
  it("registers every connector that agent-core exposes", () => {
    const missing = ALL_CONNECTOR_DEFS.filter((def) => !getConnectorDef(def.id)).map((d) => d.id)
    expect(missing).toEqual([])
  })

  it("registers no connector agent-core does not know about", () => {
    const known = new Set(ALL_CONNECTOR_DEFS.map((d) => d.id))
    const extra = getAllConnectorDefs()
      .map((d) => d.id)
      .filter((id) => !known.has(id))
    expect(extra).toEqual([])
  })

  it("gives every OAuth connector a redirect path matching its id", () => {
    for (const def of getAllConnectorDefs()) {
      if (def.auth.kind !== "oauth2") continue
      // The callback route is /callback/:id, so a mismatch here means the OAuth
      // round-trip lands on a path the console's redirect URI never allowed.
      expect(def.auth.redirectPath).toBe(`/api/integrations/callback/${def.id}`)
    }
  })
})
