import { makeComposioPostHogDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendComposioPostHogDef: BackendConnectorDef = {
  ...makeComposioPostHogDef(createComposioRestExecutor()),
  getDisplayName: async () => "PostHog (Composio)",
}

registerConnectorDef(
  isComposioBacked("posthog") ? backendComposioPostHogDef : backendComposioPostHogDef,
)
