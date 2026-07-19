import { makeComposioSheetsDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

// Sheets has no native (pre-Composio) implementation — unlike the other Google
// connectors, there's nothing to fall back to, so this always registers the
// Composio-backed def. It only actually works once "google-sheets" is in
// COMPOSIO_CONNECTORS; see all-defs.ts's unconfigured-executor comment for why.
export const backendComposioSheetsDef: BackendConnectorDef = {
  ...makeComposioSheetsDef(createComposioRestExecutor()),
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return "Sheets (Composio)"
    const data = (await res.json()) as { email?: string }
    return data.email ? `Sheets (${data.email})` : "Sheets (Composio)"
  },
}

registerConnectorDef(backendComposioSheetsDef)
