import { makeComposioGoogleCloudVisionDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioGoogleCloudVisionDef: BackendConnectorDef = {
  ...makeComposioGoogleCloudVisionDef(createComposioRestExecutor()),
  getDisplayName: async () => "Google Cloud Vision (Composio)",
}

registerConnectorDef(isComposioBacked("google-cloud-vision") ? backendComposioGoogleCloudVisionDef : backendComposioGoogleCloudVisionDef)