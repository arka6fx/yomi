import { makeComposioAsanaDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioAsanaDef: BackendConnectorDef = {
  ...makeComposioAsanaDef(createComposioRestExecutor()),
  getDisplayName: async () => "Asana (Composio)",
}

registerConnectorDef(isComposioBacked("asana") ? backendComposioAsanaDef : backendComposioAsanaDef)
