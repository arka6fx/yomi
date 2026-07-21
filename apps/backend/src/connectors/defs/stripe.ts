import { makeComposioStripeDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioStripeDef: BackendConnectorDef = {
  ...makeComposioStripeDef(createComposioRestExecutor()),
  getDisplayName: async () => "Stripe (Composio)",
}

registerConnectorDef(isComposioBacked("stripe") ? backendComposioStripeDef : backendComposioStripeDef)
