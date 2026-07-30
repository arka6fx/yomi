import { makeComposioSerpapiDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioSerpapiDef: BackendConnectorDef = {
  ...makeComposioSerpapiDef(createComposioRestExecutor()),
  getDisplayName: async () => "SerpApi (Composio)",
}

registerConnectorDef(
  isComposioBacked("serpapi") ? backendComposioSerpapiDef : backendComposioSerpapiDef,
)
