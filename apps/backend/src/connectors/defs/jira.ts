import { makeComposioJiraDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioJiraDef: BackendConnectorDef = {
  ...makeComposioJiraDef(createComposioRestExecutor()),
  getDisplayName: async () => "Jira (Composio)",
}

registerConnectorDef(isComposioBacked("jira") ? backendComposioJiraDef : backendComposioJiraDef)
