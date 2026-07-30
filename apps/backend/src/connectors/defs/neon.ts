import { makeComposioNeonDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioNeonDef: BackendConnectorDef = {
  ...makeComposioNeonDef(createComposioRestExecutor()),
  getDisplayName: async () => "Neon (Composio)",
}

registerConnectorDef(isComposioBacked("neon") ? backendComposioNeonDef : backendComposioNeonDef)
