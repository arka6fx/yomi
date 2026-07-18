import { googleGmailDef, makeComposioGmailDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendGoogleGmailDef: BackendConnectorDef = {
  ...googleGmailDef,
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Google Gmail"
    const data = (await res.json()) as { email?: string }
    return data.email ?? "Google Gmail"
  },
}

export const backendComposioGmailDef: BackendConnectorDef = {
  ...makeComposioGmailDef(createComposioRestExecutor()),
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Gmail (Composio)"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Gmail (${data.email})` : "Gmail (Composio)"
  },
}

registerConnectorDef(isComposioBacked("google") ? backendComposioGmailDef : backendGoogleGmailDef)
