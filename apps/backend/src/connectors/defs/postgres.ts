import { postgresDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"

// DSN-based connectors: display name comes from the DSN host
export const backendPostgresDef: BackendConnectorDef = {
  ...postgresDef,
  getDisplayName: async (accessToken) => {
    try {
      const url = new URL(accessToken)
      return `PostgreSQL (${url.hostname})`
    } catch {
      return "PostgreSQL"
    }
  },
}

registerConnectorDef(backendPostgresDef)
