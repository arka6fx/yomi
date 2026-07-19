import { makeComposioDocsDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

// Docs has no native (pre-Composio) implementation — unlike the other Google
// connectors, there's nothing to fall back to, so this always registers the
// Composio-backed def. It only actually works once "google-docs" is in
// COMPOSIO_CONNECTORS; see all-defs.ts's unconfigured-executor comment for why.
export const backendComposioDocsDef: BackendConnectorDef = {
  ...makeComposioDocsDef(createComposioRestExecutor()),
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Docs (Composio)"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Docs (${data.email})` : "Docs (Composio)"
  },
}

registerConnectorDef(backendComposioDocsDef)
