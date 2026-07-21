import { makeComposioAttioDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioAttioDef: BackendConnectorDef = {
  ...makeComposioAttioDef(createComposioRestExecutor()),
  getDisplayName: async () => "Attio (Composio)",
}

registerConnectorDef(isComposioBacked("attio") ? backendComposioAttioDef : backendComposioAttioDef)
