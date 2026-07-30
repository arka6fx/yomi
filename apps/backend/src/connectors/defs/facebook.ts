import { makeComposioFacebookDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioFacebookDef: BackendConnectorDef = {
  ...makeComposioFacebookDef(createComposioRestExecutor()),
  getDisplayName: async () => "Facebook (Composio)",
}

registerConnectorDef(
  isComposioBacked("facebook") ? backendComposioFacebookDef : backendComposioFacebookDef,
)
