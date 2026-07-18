import { googleDriveDef, makeComposioDriveDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendGoogleDriveDef: BackendConnectorDef = {
  ...googleDriveDef,
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Google Drive"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Drive (${data.email})` : "Google Drive"
  },
}

export const backendComposioDriveDef: BackendConnectorDef = {
  ...makeComposioDriveDef(createComposioRestExecutor()),
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Drive (Composio)"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Drive (${data.email})` : "Drive (Composio)"
  },
}

registerConnectorDef(isComposioBacked("google-drive") ? backendComposioDriveDef : backendGoogleDriveDef)
