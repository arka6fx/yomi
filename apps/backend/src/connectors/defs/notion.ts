import { notionDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"

export const backendNotionDef: BackendConnectorDef = {
  ...notionDef,
  getDisplayName: async (accessToken) => {
    try {
      const res = await fetch("https://api.notion.com/v1/users/me", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Notion-Version": "2022-06-28",
        },
      })
      if (!res.ok) return "Notion"
      const data = (await res.json()) as { name?: string; person?: { email?: string } }
      return data.person?.email ?? data.name ?? "Notion"
    } catch {
      return "Notion"
    }
  },
}

registerConnectorDef(backendNotionDef)
