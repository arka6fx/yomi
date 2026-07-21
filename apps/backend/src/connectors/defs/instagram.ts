import { makeComposioInstagramDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioInstagramDef: BackendConnectorDef = {
  ...makeComposioInstagramDef(createComposioRestExecutor()),
  getDisplayName: async () => "Instagram (Composio)",
}

registerConnectorDef(isComposioBacked("instagram") ? backendComposioInstagramDef : backendComposioInstagramDef)
