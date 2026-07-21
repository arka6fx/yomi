import { makeComposioMicrosoftTeamsDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioMicrosoftTeamsDef: BackendConnectorDef = {
  ...makeComposioMicrosoftTeamsDef(createComposioRestExecutor()),
  getDisplayName: async () => "Microsoft Teams (Composio)",
}

registerConnectorDef(isComposioBacked("microsoft-teams") ? backendComposioMicrosoftTeamsDef : backendComposioMicrosoftTeamsDef)
