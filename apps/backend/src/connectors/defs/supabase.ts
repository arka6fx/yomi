import { makeComposioSupabaseDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioSupabaseDef: BackendConnectorDef = {
  ...makeComposioSupabaseDef(createComposioRestExecutor()),
  getDisplayName: async () => "Supabase (Composio)",
}

registerConnectorDef(
  isComposioBacked("supabase") ? backendComposioSupabaseDef : backendComposioSupabaseDef,
)
