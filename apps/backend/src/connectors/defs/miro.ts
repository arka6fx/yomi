import { makeComposioMiroDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioMiroDef: BackendConnectorDef = {
  ...makeComposioMiroDef(createComposioRestExecutor()),
  getDisplayName: async () => "Miro (Composio)",
}

registerConnectorDef(isComposioBacked("miro") ? backendComposioMiroDef : backendComposioMiroDef)
