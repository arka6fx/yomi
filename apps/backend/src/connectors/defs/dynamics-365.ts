import { makeComposioDynamics365Def, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioDynamics365Def: BackendConnectorDef = {
  ...makeComposioDynamics365Def(createComposioRestExecutor()),
  getDisplayName: async () => "Dynamics 365 (Composio)",
}

registerConnectorDef(isComposioBacked("dynamics-365") ? backendComposioDynamics365Def : backendComposioDynamics365Def)
