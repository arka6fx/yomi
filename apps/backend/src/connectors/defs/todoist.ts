import { makeComposioTodoistDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioTodoistDef: BackendConnectorDef = {
  ...makeComposioTodoistDef(createComposioRestExecutor()),
  getDisplayName: async () => "Todoist (Composio)",
}

registerConnectorDef(isComposioBacked("todoist") ? backendComposioTodoistDef : backendComposioTodoistDef)
