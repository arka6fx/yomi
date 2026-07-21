import { makeComposioGooglePhotosDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioGooglePhotosDef: BackendConnectorDef = {
  ...makeComposioGooglePhotosDef(createComposioRestExecutor()),
  getDisplayName: async () => "Google Photos (Composio)",
}

registerConnectorDef(isComposioBacked("google-photos") ? backendComposioGooglePhotosDef : backendComposioGooglePhotosDef)