import { makeComposioExaDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioExaDef: BackendConnectorDef = {
  ...makeComposioExaDef(createComposioRestExecutor()),
  getDisplayName: async () => "Exa (Composio)",
}

registerConnectorDef(isComposioBacked("exa") ? backendComposioExaDef : backendComposioExaDef)
