import { makeComposioSlidesDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

// Slides has no native (pre-Composio) implementation — unlike the other Google
// connectors, there's nothing to fall back to, so this always registers the
// Composio-backed def. It only actually works once "google-slides" is in
// COMPOSIO_CONNECTORS; see all-defs.ts's unconfigured-executor comment for why.
export const backendComposioSlidesDef: BackendConnectorDef = {
  ...makeComposioSlidesDef(createComposioRestExecutor()),
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Slides (Composio)"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Slides (${data.email})` : "Slides (Composio)"
  },
}

registerConnectorDef(backendComposioSlidesDef)
