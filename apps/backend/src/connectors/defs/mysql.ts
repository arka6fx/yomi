import { mysqlDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"

export const backendMysqlDef: BackendConnectorDef = {
  ...mysqlDef,
  getDisplayName: async (accessToken) => {
    try {
      const url = new URL(accessToken)
      return `MySQL (${url.hostname})`
    } catch {
      return "MySQL"
    }
  },
}

registerConnectorDef(backendMysqlDef)
