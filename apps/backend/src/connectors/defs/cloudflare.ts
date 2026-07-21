import { makeComposioCloudflareDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioCloudflareDef: BackendConnectorDef = {
  ...makeComposioCloudflareDef(createComposioRestExecutor()),
  getDisplayName: async () => "Cloudflare (Composio)",
}

registerConnectorDef(isComposioBacked("cloudflare") ? backendComposioCloudflareDef : backendComposioCloudflareDef)
