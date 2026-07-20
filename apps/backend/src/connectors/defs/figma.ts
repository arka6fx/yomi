import { makeComposioFigmaDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioFigmaDef: BackendConnectorDef = {
  ...makeComposioFigmaDef(createComposioRestExecutor()),
  getDisplayName: async () => "Figma (Composio)",
}

registerConnectorDef(isComposioBacked("figma") ? backendComposioFigmaDef : backendComposioFigmaDef)
