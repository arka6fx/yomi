import { makeComposioVercelDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioVercelDef: BackendConnectorDef = {
  ...makeComposioVercelDef(createComposioRestExecutor()),
  getDisplayName: async () => "Vercel (Composio)",
}

registerConnectorDef(
  isComposioBacked("vercel") ? backendComposioVercelDef : backendComposioVercelDef,
)
