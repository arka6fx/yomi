import { makeComposioZohoInvoiceDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioZohoInvoiceDef: BackendConnectorDef = {
  ...makeComposioZohoInvoiceDef(createComposioRestExecutor()),
  getDisplayName: async () => "Zoho Invoice (Composio)",
}

registerConnectorDef(
  isComposioBacked("zoho-invoice") ? backendComposioZohoInvoiceDef : backendComposioZohoInvoiceDef,
)
