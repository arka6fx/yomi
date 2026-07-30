import { makeComposioTrelloDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioTrelloDef: BackendConnectorDef = {
  ...makeComposioTrelloDef(createComposioRestExecutor()),
  getDisplayName: async () => "Trello (Composio)",
}

registerConnectorDef(
  isComposioBacked("trello") ? backendComposioTrelloDef : backendComposioTrelloDef,
)
