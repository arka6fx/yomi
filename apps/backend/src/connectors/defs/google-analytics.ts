import { makeComposioGoogleAnalyticsDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioGoogleAnalyticsDef: BackendConnectorDef = {
  ...makeComposioGoogleAnalyticsDef(createComposioRestExecutor()),
  getDisplayName: async () => "Google Analytics (Composio)",
}

registerConnectorDef(
  isComposioBacked("google-analytics")
    ? backendComposioGoogleAnalyticsDef
    : backendComposioGoogleAnalyticsDef,
)
