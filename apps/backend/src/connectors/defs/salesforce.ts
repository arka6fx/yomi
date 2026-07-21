import { makeComposioSalesforceDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioSalesforceDef: BackendConnectorDef = {
  ...makeComposioSalesforceDef(createComposioRestExecutor()),
  getDisplayName: async () => "Salesforce (Composio)",
}

registerConnectorDef(isComposioBacked("salesforce") ? backendComposioSalesforceDef : backendComposioSalesforceDef)
