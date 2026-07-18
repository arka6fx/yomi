import { linearDef, linearApiKeyDef, makeComposioLinearDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

async function getLinearDisplayName(accessToken: string): Promise<string> {
  try {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "{ viewer { name email organization { name } } }" }),
    })
    if (!res.ok) return "Linear"
    const data = (await res.json()) as {
      data?: { viewer?: { name?: string; email?: string; organization?: { name?: string } } }
    }
    const viewer = data.data?.viewer
    if (!viewer) return "Linear"
    const org = viewer.organization?.name
    return org
      ? `${viewer.name ?? viewer.email ?? "Linear"} (${org})`
      : (viewer.name ?? viewer.email ?? "Linear")
  } catch {
    return "Linear"
  }
}

export const backendLinearDef: BackendConnectorDef = {
  ...linearDef,
  getDisplayName: getLinearDisplayName,
}

export const backendLinearApiKeyDef: BackendConnectorDef = {
  ...linearApiKeyDef,
  getDisplayName: getLinearDisplayName,
}

// Composio-backed Linear: registered for the "linear" id when the connector is
// flagged. The api-key variant is a distinct id and always stays native. This is
// the replay/connect side of the per-connector switch; the agent-loop side is the
// composioDefs passed to ConnectorRegistry in agent/run.ts. Native code retained.
export const backendComposioLinearDef: BackendConnectorDef = {
  ...makeComposioLinearDef(createComposioRestExecutor()),
  getDisplayName: async () => "Linear (Composio)",
}

registerConnectorDef(backendLinearApiKeyDef)
registerConnectorDef(isComposioBacked("linear") ? backendComposioLinearDef : backendLinearDef)
