import { makeComposioMapsDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendGoogleMapsDef: BackendConnectorDef = {
  ...makeComposioMapsDef(createComposioRestExecutor()),
  getDisplayName: async () => "Google Maps (Composio)",
}

registerConnectorDef(backendGoogleMapsDef)
