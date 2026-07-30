import { makeComposioDiscordDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioDiscordDef: BackendConnectorDef = {
  ...makeComposioDiscordDef(createComposioRestExecutor()),
  getDisplayName: async () => "Discord (Composio)",
}

registerConnectorDef(
  isComposioBacked("discord") ? backendComposioDiscordDef : backendComposioDiscordDef,
)
