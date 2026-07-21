import { makeComposioFirefliesDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioFirefliesDef: BackendConnectorDef = {
  ...makeComposioFirefliesDef(createComposioRestExecutor()),
  getDisplayName: async () => "Fireflies (Composio)",
}

registerConnectorDef(isComposioBacked("fireflies") ? backendComposioFirefliesDef : backendComposioFirefliesDef)