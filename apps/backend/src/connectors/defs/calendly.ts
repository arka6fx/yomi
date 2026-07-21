import { makeComposioCalendlyDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioCalendlyDef: BackendConnectorDef = {
  ...makeComposioCalendlyDef(createComposioRestExecutor()),
  getDisplayName: async () => "Calendly (Composio)",
}

registerConnectorDef(isComposioBacked("calendly") ? backendComposioCalendlyDef : backendComposioCalendlyDef)
