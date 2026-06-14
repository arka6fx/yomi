import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"

export function createGitHubTools(ctx: ConnectorContext): ToolSet {
  async function gh<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await ctx.getAccessToken(ctx.userId, "github")
    const base = "https://api.github.com"
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GitHub API ${path} → ${res.status}: ${body.slice(0, 200)}`)
    }
    return res.json() as Promise<T>
  }

  return {
    "github.listPRs": tool({
      description:
        "List open pull requests in a GitHub repository. Returns PR number, title, author, branch, and URL.",
      parameters: z.object({
        owner: z.string().describe("Repository owner (username or org)"),
        repo: z.string().describe("Repository name"),
        state: z
          .enum(["open", "closed", "all"])
          .default("open")
          .describe("PR state filter"),
        limit: z.number().int().min(1).max(30).default(10).describe("Max PRs to return"),
      }),
      execute: async ({ owner, repo, state, limit }) => {
        try {
          const prs = await gh<
            {
              number: number
              title: string
              user: { login: string }
              head: { ref: string }
              base: { ref: string }
              html_url: string
              created_at: string
              draft: boolean
            }[]
          >(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=${limit}`)
          if (prs.length === 0) return { prs: [], message: `No ${state} PRs found.` }
          return {
            count: prs.length,
            prs: prs.map((p) => ({
              number: p.number,
              title: p.title,
              author: p.user.login,
              branch: `${p.head.ref} → ${p.base.ref}`,
              url: p.html_url,
              created: p.created_at,
              draft: p.draft,
            })),
          }
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to fetch PRs" }
        }
      },
    }),

    "github.getPR": tool({
      description: "Get details for a specific GitHub pull request, including description and review status.",
      parameters: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        prNumber: z.number().int().describe("Pull request number"),
      }),
      execute: async ({ owner, repo, prNumber }) => {
        try {
          const pr = await gh<{
            number: number
            title: string
            body?: string
            user: { login: string }
            head: { ref: string }
            base: { ref: string }
            html_url: string
            state: string
            draft: boolean
            created_at: string
            merged_at?: string
            merge_commit_sha?: string
            additions: number
            deletions: number
            changed_files: number
          }>(`/repos/${owner}/${repo}/pulls/${prNumber}`)
          return {
            number: pr.number,
            title: pr.title,
            description: pr.body?.slice(0, 2000),
            author: pr.user.login,
            branch: `${pr.head.ref} → ${pr.base.ref}`,
            state: pr.state,
            draft: pr.draft,
            url: pr.html_url,
            created: pr.created_at,
            merged: pr.merged_at,
            stats: {
              additions: pr.additions,
              deletions: pr.deletions,
              filesChanged: pr.changed_files,
            },
          }
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to fetch PR" }
        }
      },
    }),

    "github.listIssues": tool({
      description: "List issues in a GitHub repository. Returns issue number, title, author, labels, and URL.",
      parameters: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        state: z.enum(["open", "closed", "all"]).default("open").describe("Issue state filter"),
        label: z.string().optional().describe("Filter by label name"),
        limit: z.number().int().min(1).max(30).default(10).describe("Max issues to return"),
      }),
      execute: async ({ owner, repo, state, label, limit }) => {
        try {
          const params = new URLSearchParams({
            state,
            per_page: String(limit),
            ...(label ? { labels: label } : {}),
          })
          const issues = await gh<
            {
              number: number
              title: string
              user: { login: string }
              html_url: string
              created_at: string
              labels: { name: string }[]
              pull_request?: unknown
            }[]
          >(`/repos/${owner}/${repo}/issues?${params}`)
          // Filter out PRs (GitHub issues endpoint returns PRs too)
          const filtered = issues.filter((i) => !i.pull_request)
          if (filtered.length === 0) return { issues: [], message: `No ${state} issues found.` }
          return {
            count: filtered.length,
            issues: filtered.map((i) => ({
              number: i.number,
              title: i.title,
              author: i.user.login,
              labels: i.labels.map((l) => l.name),
              url: i.html_url,
              created: i.created_at,
            })),
          }
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to fetch issues" }
        }
      },
    }),

    "github.getIssue": tool({
      description: "Get details for a specific GitHub issue, including body and comments count.",
      parameters: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        issueNumber: z.number().int().describe("Issue number"),
      }),
      execute: async ({ owner, repo, issueNumber }) => {
        try {
          const issue = await gh<{
            number: number
            title: string
            body?: string
            user: { login: string }
            html_url: string
            state: string
            created_at: string
            updated_at: string
            comments: number
            labels: { name: string }[]
          }>(`/repos/${owner}/${repo}/issues/${issueNumber}`)
          return {
            number: issue.number,
            title: issue.title,
            body: issue.body?.slice(0, 3000),
            author: issue.user.login,
            state: issue.state,
            labels: issue.labels.map((l) => l.name),
            url: issue.html_url,
            created: issue.created_at,
            updated: issue.updated_at,
            comments: issue.comments,
          }
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to fetch issue" }
        }
      },
    }),
  }
}

export const githubDef: ConnectorDef = {
  id: "github",
  name: "GitHub",
  category: "engineering",
  icon: "github",
  description: "View pull requests, issues, and repositories from your GitHub account.",
  readOnlyByDefault: true,
  auth: {
    kind: "oauth2",
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    // GitHub tokens do not expire by default — no expiresAt stored
    scopes: ["repo", "read:user"],
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
    redirectPath: "/api/integrations/callback/github",
  },
  setup: {
    providerConsoleUrl: "https://github.com/settings/developers",
    steps: [
      "Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App",
      "Application name: Yomi",
      "Homepage URL: ${BACKEND_URL}",
      "Authorization callback URL: ${BACKEND_URL}/api/integrations/callback/github",
      "Click Register application, then copy the Client ID and Client Secret",
    ],
    collect: [
      { env: "GITHUB_CLIENT_ID", label: "GitHub Client ID", secret: false },
      { env: "GITHUB_CLIENT_SECRET", label: "GitHub Client Secret", secret: true },
    ],
    docsUrl: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps",
  },
  tools: createGitHubTools,
}
