import { googleCalendarDef, makeComposioCalendarDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendGoogleCalendarDef: BackendConnectorDef = {
  ...googleCalendarDef,
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Google Calendar"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Calendar (${data.email})` : "Google Calendar"
  },
}

export const backendComposioCalendarDef: BackendConnectorDef = {
  ...makeComposioCalendarDef(createComposioRestExecutor()),
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Calendar (Composio)"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Calendar (${data.email})` : "Calendar (Composio)"
  },
}

registerConnectorDef(isComposioBacked("google-calendar") ? backendComposioCalendarDef : backendGoogleCalendarDef)
