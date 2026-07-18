import { googleTasksDef, makeComposioTasksDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendGoogleTasksDef: BackendConnectorDef = {
  ...googleTasksDef,
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Google Tasks"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Tasks (${data.email})` : "Google Tasks"
  },
}

export const backendComposioTasksDef: BackendConnectorDef = {
  ...makeComposioTasksDef(createComposioRestExecutor()),
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Tasks (Composio)"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Tasks (${data.email})` : "Tasks (Composio)"
  },
}

registerConnectorDef(isComposioBacked("google-tasks") ? backendComposioTasksDef : backendGoogleTasksDef)
