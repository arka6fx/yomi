import { makeComposioFirecrawlDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioFirecrawlDef: BackendConnectorDef = {
  ...makeComposioFirecrawlDef(createComposioRestExecutor()),
  getDisplayName: async () => "Firecrawl (Composio)",
}

registerConnectorDef(
  isComposioBacked("firecrawl") ? backendComposioFirecrawlDef : backendComposioFirecrawlDef,
)
