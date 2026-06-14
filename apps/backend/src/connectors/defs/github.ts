import { githubDef } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"

export const backendGithubDef: BackendConnectorDef = {
  ...githubDef,
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
    if (!res.ok) return "GitHub"
    const data = (await res.json()) as { login?: string; name?: string }
    return data.name ?? data.login ?? "GitHub"
  },
}

registerConnectorDef(backendGithubDef)
