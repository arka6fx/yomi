import { linearDef, linearApiKeyDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"

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
    return org ? `${viewer.name ?? viewer.email ?? "Linear"} (${org})` : (viewer.name ?? viewer.email ?? "Linear")
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

registerConnectorDef(backendLinearDef)
registerConnectorDef(backendLinearApiKeyDef)
