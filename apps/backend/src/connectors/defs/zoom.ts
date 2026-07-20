import { makeComposioZoomDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioZoomDef: BackendConnectorDef = {
  ...makeComposioZoomDef(createComposioRestExecutor()),
  getDisplayName: async () => "Zoom (Composio)",
}

registerConnectorDef(isComposioBacked("zoom") ? backendComposioZoomDef : backendComposioZoomDef)
