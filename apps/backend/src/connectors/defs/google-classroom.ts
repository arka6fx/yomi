import { googleClassroomDef, makeComposioClassroomDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendGoogleClassroomDef: BackendConnectorDef = {
  ...googleClassroomDef,
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Google Classroom"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Classroom (${data.email})` : "Google Classroom"
  },
}

export const backendComposioClassroomDef: BackendConnectorDef = {
  ...makeComposioClassroomDef(createComposioRestExecutor()),
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Classroom (Composio)"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Classroom (${data.email})` : "Classroom (Composio)"
  },
}

registerConnectorDef(
  isComposioBacked("google-classroom") ? backendComposioClassroomDef : backendGoogleClassroomDef,
)
