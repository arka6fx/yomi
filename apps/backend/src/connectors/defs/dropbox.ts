import { makeComposioDropboxDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioDropboxDef: BackendConnectorDef = {
  ...makeComposioDropboxDef(createComposioRestExecutor()),
  getDisplayName: async () => "Dropbox (Composio)",
}

registerConnectorDef(
  isComposioBacked("dropbox") ? backendComposioDropboxDef : backendComposioDropboxDef,
)
