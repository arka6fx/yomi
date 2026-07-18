import { githubDef, makeComposioGitHubDef, isComposioBacked } from "@yomi/agent-core"
import type { BackendConnectorDef } from "../types.js"
import { registerConnectorDef } from "../registry.js"
import { createComposioRestExecutor } from "../composio-executor.js"

export const backendGithubDef: BackendConnectorDef = {
  ...githubDef,
  getDisplayName: async (accessToken) => {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "yomi-app",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
    if (!res.ok) return "GitHub"
    const data = (await res.json()) as { login?: string; name?: string }
    return data.name ?? data.login ?? "GitHub"
  },
}

export const backendComposioGitHubDef: BackendConnectorDef = {
  ...makeComposioGitHubDef(createComposioRestExecutor()),
  getDisplayName: async () => "GitHub (Composio)",
}

registerConnectorDef(isComposioBacked("github") ? backendComposioGitHubDef : backendGithubDef)
