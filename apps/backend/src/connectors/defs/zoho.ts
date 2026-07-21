import { makeComposioZohoDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioZohoDef: BackendConnectorDef = {
  ...makeComposioZohoDef(createComposioRestExecutor()),
  getDisplayName: async () => "Zoho CRM (Composio)",
}

registerConnectorDef(isComposioBacked("zoho") ? backendComposioZohoDef : backendComposioZohoDef)
