import { googleMeetDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"

export const backendGoogleMeetDef: BackendConnectorDef = {
  ...googleMeetDef,
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Google Meet"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Meet (${data.email})` : "Google Meet"
  },
}

registerConnectorDef(backendGoogleMeetDef)
