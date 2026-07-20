import { makeComposioOutlookDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioOutlookDef: BackendConnectorDef = {
  ...makeComposioOutlookDef(createComposioRestExecutor()),
  getDisplayName: async () => "Outlook (Composio)",
}

registerConnectorDef(isComposioBacked("outlook") ? backendComposioOutlookDef : backendComposioOutlookDef)
