import { makeComposioKaggleDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioKaggleDef: BackendConnectorDef = {
  ...makeComposioKaggleDef(createComposioRestExecutor()),
  getDisplayName: async () => "Kaggle (Composio)",
}

registerConnectorDef(
  isComposioBacked("kaggle") ? backendComposioKaggleDef : backendComposioKaggleDef,
)
