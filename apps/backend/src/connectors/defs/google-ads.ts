import { makeComposioGoogleAdsDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioGoogleAdsDef: BackendConnectorDef = {
  ...makeComposioGoogleAdsDef(createComposioRestExecutor()),
  getDisplayName: async () => "Google Ads (Composio)",
}

registerConnectorDef(
  isComposioBacked("google-ads") ? backendComposioGoogleAdsDef : backendComposioGoogleAdsDef,
)
