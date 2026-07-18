import { swiggyDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"

export const backendSwiggyDef: BackendConnectorDef = {
  ...swiggyDef,
  getDisplayName: async () => "Swiggy",
}

registerConnectorDef(backendSwiggyDef)
