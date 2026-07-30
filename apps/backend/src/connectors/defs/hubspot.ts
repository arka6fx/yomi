import { makeComposioHubspotDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioHubspotDef: BackendConnectorDef = {
  ...makeComposioHubspotDef(createComposioRestExecutor()),
  getDisplayName: async () => "HubSpot (Composio)",
}

registerConnectorDef(
  isComposioBacked("hubspot") ? backendComposioHubspotDef : backendComposioHubspotDef,
)
