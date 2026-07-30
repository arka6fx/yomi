import { makeComposioRedditDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioRedditDef: BackendConnectorDef = {
  ...makeComposioRedditDef(createComposioRestExecutor()),
  getDisplayName: async () => "Reddit (Composio)",
}

registerConnectorDef(
  isComposioBacked("reddit") ? backendComposioRedditDef : backendComposioRedditDef,
)
