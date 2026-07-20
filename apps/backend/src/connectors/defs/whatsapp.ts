import { makeComposioWhatsAppDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioWhatsAppDef: BackendConnectorDef = {
  ...makeComposioWhatsAppDef(createComposioRestExecutor()),
  getDisplayName: async () => "WhatsApp (Composio)",
}

registerConnectorDef(isComposioBacked("whatsapp") ? backendComposioWhatsAppDef : backendComposioWhatsAppDef)
