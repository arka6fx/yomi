import { makeComposioGoogleSearchConsoleDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioGoogleSearchConsoleDef: BackendConnectorDef = {
  ...makeComposioGoogleSearchConsoleDef(createComposioRestExecutor()),
  getDisplayName: async () => "Google Search Console (Composio)",
}

registerConnectorDef(
  isComposioBacked("google-search-console")
    ? backendComposioGoogleSearchConsoleDef
    : backendComposioGoogleSearchConsoleDef,
)
