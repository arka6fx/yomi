import { makeComposioGooglePhotosDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioGooglePhotosDef: BackendConnectorDef = {
  ...makeComposioGooglePhotosDef(createComposioRestExecutor()),
  getDisplayName: async () => "Google Photos (Composio)",
}

// Composio-only connector — no direct-API fallback to switch to.
registerConnectorDef(backendComposioGooglePhotosDef)
