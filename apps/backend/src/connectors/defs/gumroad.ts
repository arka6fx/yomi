import { makeComposioGumroadDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioGumroadDef: BackendConnectorDef = {
  ...makeComposioGumroadDef(createComposioRestExecutor()),
  getDisplayName: async () => "Gumroad (Composio)",
}

registerConnectorDef(
  isComposioBacked("gumroad") ? backendComposioGumroadDef : backendComposioGumroadDef,
)
