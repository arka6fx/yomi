import { makeComposioOneDriveDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioOneDriveDef: BackendConnectorDef = {
  ...makeComposioOneDriveDef(createComposioRestExecutor()),
  getDisplayName: async () => "OneDrive (Composio)",
}

registerConnectorDef(isComposioBacked("one-drive") ? backendComposioOneDriveDef : backendComposioOneDriveDef)
