import { makeComposioLinkedInDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioLinkedInDef: BackendConnectorDef = {
  ...makeComposioLinkedInDef(createComposioRestExecutor()),
  getDisplayName: async () => "LinkedIn (Composio)",
}

registerConnectorDef(
  isComposioBacked("linkedin") ? backendComposioLinkedInDef : backendComposioLinkedInDef,
)
