import { makeComposioMem0Def, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioMem0Def: BackendConnectorDef = {
  ...makeComposioMem0Def(createComposioRestExecutor()),
  getDisplayName: async () => "Mem0 (Composio)",
}

registerConnectorDef(isComposioBacked("mem0") ? backendComposioMem0Def : backendComposioMem0Def)
