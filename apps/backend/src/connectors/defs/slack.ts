import { slackDef, makeComposioSlackDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendSlackDef: BackendConnectorDef = {
  ...slackDef,
  getDisplayName: async (accessToken) => {
    try {
      const res = await fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      })
      if (!res.ok) return "Slack"
      const data = (await res.json()) as { ok: boolean; team?: string; user?: string }
      if (!data.ok) return "Slack"
      return data.team ? `${data.user ?? "Slack"} (${data.team})` : (data.user ?? "Slack")
    } catch {
      return "Slack"
    }
  },
}

export const backendComposioSlackDef: BackendConnectorDef = {
  ...makeComposioSlackDef(createComposioRestExecutor()),
  getDisplayName: async () => "Slack (Composio)",
}

registerConnectorDef(isComposioBacked("slack") ? backendComposioSlackDef : backendSlackDef)
