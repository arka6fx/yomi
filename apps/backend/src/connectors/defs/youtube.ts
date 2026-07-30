import { makeComposioYouTubeDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioYouTubeDef: BackendConnectorDef = {
  ...makeComposioYouTubeDef(createComposioRestExecutor()),
  getDisplayName: async () => "YouTube (Composio)",
}

registerConnectorDef(
  isComposioBacked("youtube") ? backendComposioYouTubeDef : backendComposioYouTubeDef,
)
