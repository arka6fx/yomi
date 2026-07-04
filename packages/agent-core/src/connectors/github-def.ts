import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError, gateWrite } from "./connector-def.js"

export function createGitHubTools(ctx: ConnectorContext): ToolSet {
  function base64Encode(input: string): string {
    let binary = ""
    for (const byte of new TextEncoder().encode(input)) binary += String.fromCharCode(byte)
    return btoa(binary)
  }

  async function gh<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await ctx.getAccessToken(ctx.userId, "github")
    const base = "https://api.github.com"
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "yomi-app",
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
    "github-listPRs": tool({
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
          return connectorError(err)
        }
      },
    }),

    "github-getPR": tool({
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
          return connectorError(err)
        }
      },
    }),

    "github-listIssues": tool({
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
          return connectorError(err)
        }
      },
    }),

    "github-getIssue": tool({
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
          return connectorError(err)
        }
      },
    }),

    "github-createIssue": tool({
      description:
        "Create a new issue in a GitHub repository. IMPORTANT: confirm the repo, title, and body with the user before calling this tool.",
      parameters: z.object({
        owner: z.string().describe("Repository owner (username or org)"),
        repo: z.string().describe("Repository name"),
        title: z.string().describe("Issue title"),
        body: z.string().optional().describe("Issue body (markdown)"),
        labels: z.array(z.string()).optional().describe("Label names to apply"),
        assignees: z.array(z.string()).optional().describe("GitHub usernames to assign"),
      }),
      execute: async (args) => {
        const { owner, repo, title, body, labels, assignees } = args
        return gateWrite(
          ctx,
          {
            connector: "github",
            action: "github-createIssue",
            risk: "write",
            title: `Create GitHub issue in ${owner}/${repo}`,
            preview: `${title}\n\n${(body ?? "").slice(0, 800)}`,
            confirmText: "Create issue",
          },
          args,
          async () => {
            try {
              const issue = await gh<{ number: number; title: string; html_url: string; state: string }>(
                `/repos/${owner}/${repo}/issues`,
                {
                  method: "POST",
                  body: JSON.stringify({ title, body, labels, assignees }),
                },
              )
              return {
                ok: true,
                number: issue.number,
                title: issue.title,
                state: issue.state,
                url: issue.html_url,
              }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "github-updateIssue": tool({
      description:
        "Update a GitHub issue: close/reopen it or edit its title, body, or labels. IMPORTANT: confirm the change with the user before calling this tool.",
      parameters: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        issueNumber: z.number().int().describe("Issue number"),
        state: z.enum(["open", "closed"]).optional().describe("Set to 'closed' to close, 'open' to reopen"),
        title: z.string().optional().describe("New title"),
        body: z.string().optional().describe("New body (markdown)"),
        labels: z.array(z.string()).optional().describe("Replace labels with this set"),
      }),
      execute: async ({ owner, repo, issueNumber, state, title, body, labels }) => {
        try {
          const patch: Record<string, unknown> = {}
          if (state) patch.state = state
          if (title !== undefined) patch.title = title
          if (body !== undefined) patch.body = body
          if (labels !== undefined) patch.labels = labels
          if (Object.keys(patch).length === 0) {
            return { error: "Nothing to update — provide at least one of state, title, body, or labels." }
          }
          const issue = await gh<{ number: number; title: string; state: string; html_url: string }>(
            `/repos/${owner}/${repo}/issues/${issueNumber}`,
            { method: "PATCH", body: JSON.stringify(patch) },
          )
          return {
            ok: true,
            number: issue.number,
            title: issue.title,
            state: issue.state,
            url: issue.html_url,
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "github-commentOnIssue": tool({
      description:
        "Add a comment to a GitHub issue or pull request (PRs share the issue comment endpoint). IMPORTANT: confirm the comment text with the user before calling this tool.",
      parameters: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        issueNumber: z.number().int().describe("Issue or pull request number"),
        body: z.string().describe("Comment body (markdown)"),
      }),
      execute: async (args) => {
        const { owner, repo, issueNumber, body } = args
        return gateWrite(
          ctx,
          {
            connector: "github",
            action: "github-commentOnIssue",
            risk: "write",
            title: `Comment on ${owner}/${repo}#${issueNumber}`,
            preview: body.slice(0, 800),
            confirmText: "Post comment",
          },
          args,
          async () => {
            try {
              const comment = await gh<{ id: number; html_url: string }>(
                `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
                { method: "POST", body: JSON.stringify({ body }) },
              )
              return { ok: true, id: comment.id, url: comment.html_url }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "github-createPR": tool({
      description:
        "Open a new pull request in a GitHub repository. IMPORTANT: confirm the title, head branch, and base branch with the user before calling this tool.",
      parameters: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        title: z.string().describe("Pull request title"),
        head: z.string().describe("Branch with your changes (e.g. 'feature-x' or 'user:feature-x')"),
        base: z.string().describe("Branch you want to merge into (e.g. 'main')"),
        body: z.string().optional().describe("Pull request description (markdown)"),
        draft: z.boolean().optional().describe("Open as a draft PR"),
      }),
      execute: async (args) => {
        const { owner, repo, title, head, base, body, draft } = args
        return gateWrite(
          ctx,
          {
            connector: "github",
            action: "github-createPR",
            risk: "write",
            title: `Open PR in ${owner}/${repo}: ${head} → ${base}`,
            preview: `${title}\n\n${(body ?? "").slice(0, 800)}`,
            confirmText: "Open pull request",
          },
          args,
          async () => {
            try {
              const pr = await gh<{ number: number; title: string; html_url: string; draft: boolean }>(
                `/repos/${owner}/${repo}/pulls`,
                { method: "POST", body: JSON.stringify({ title, head, base, body, draft }) },
              )
              return {
                ok: true,
                number: pr.number,
                title: pr.title,
                draft: pr.draft,
                url: pr.html_url,
              }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "github-mergePR": tool({
      description:
        "Merge a GitHub pull request. This is irreversible — IMPORTANT: confirm with the user before calling this tool.",
      parameters: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        prNumber: z.number().int().describe("Pull request number"),
        method: z
          .enum(["merge", "squash", "rebase"])
          .default("merge")
          .describe("Merge strategy"),
        commitTitle: z.string().optional().describe("Override the merge commit title"),
      }),
      execute: async (args) => {
        const { owner, repo, prNumber, method, commitTitle } = args
        return gateWrite(
          ctx,
          {
            connector: "github",
            action: "github-mergePR",
            risk: "irreversible",
            title: `Merge ${owner}/${repo}#${prNumber} (${method})`,
            preview: commitTitle ?? `Merge pull request #${prNumber} using ${method}`,
            confirmText: "Merge pull request",
          },
          args,
          async () => {
            try {
              const result = await gh<{ sha: string; merged: boolean; message: string }>(
                `/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
                {
                  method: "PUT",
                  body: JSON.stringify({ merge_method: method, commit_title: commitTitle }),
                },
              )
              return { ok: result.merged, sha: result.sha, message: result.message }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "github-reviewPR": tool({
      description:
        "Submit a review on a GitHub pull request: approve, request changes, or comment. IMPORTANT: confirm with the user before calling this tool.",
      parameters: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        prNumber: z.number().int().describe("Pull request number"),
        event: z
          .enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"])
          .describe("Review verdict"),
        body: z.string().optional().describe("Review comment (required for REQUEST_CHANGES/COMMENT)"),
      }),
      execute: async (args) => {
        const { owner, repo, prNumber, event, body } = args
        return gateWrite(
          ctx,
          {
            connector: "github",
            action: "github-reviewPR",
            risk: "write",
            title: `${event} review on ${owner}/${repo}#${prNumber}`,
            preview: body ?? event,
            confirmText: "Submit review",
          },
          args,
          async () => {
            try {
              const review = await gh<{ id: number; state: string; html_url: string }>(
                `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
                { method: "POST", body: JSON.stringify({ event, body }) },
              )
              return { ok: true, id: review.id, state: review.state, url: review.html_url }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "github-addLabels": tool({
      description: "Add one or more labels to a GitHub issue or pull request.",
      parameters: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        issueNumber: z.number().int().describe("Issue or pull request number"),
        labels: z.array(z.string()).min(1).describe("Label names to add"),
      }),
      execute: async ({ owner, repo, issueNumber, labels }) => {
        try {
          const result = await gh<{ name: string }[]>(
            `/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
            { method: "POST", body: JSON.stringify({ labels }) },
          )
          return { ok: true, labels: result.map((l) => l.name) }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "github-createBranch": tool({
      description: "Create a new branch in a GitHub repository from an existing branch.",
      parameters: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        branch: z.string().describe("New branch name"),
        fromBranch: z.string().default("main").describe("Branch to fork from"),
      }),
      execute: async ({ owner, repo, branch, fromBranch }) => {
        try {
          const ref = await gh<{ object: { sha: string } }>(
            `/repos/${owner}/${repo}/git/ref/heads/${fromBranch}`,
          )
          const created = await gh<{ ref: string; object: { sha: string } }>(
            `/repos/${owner}/${repo}/git/refs`,
            {
              method: "POST",
              body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }),
            },
          )
          return { ok: true, ref: created.ref, sha: created.object.sha }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "github-listRepos": tool({
      description: "List repositories the authenticated user has access to.",
      parameters: z.object({
        affiliation: z
          .enum(["owner", "collaborator", "organization_member"])
          .optional()
          .describe("Filter by relationship to the repo"),
        sort: z.enum(["created", "updated", "pushed", "full_name"]).default("pushed"),
        limit: z.number().int().min(1).max(50).default(20).describe("Max repos to return"),
      }),
      execute: async ({ affiliation, sort, limit }) => {
        try {
          const params = new URLSearchParams({
            sort,
            per_page: String(limit),
            ...(affiliation ? { affiliation } : {}),
          })
          const repos = await gh<
            {
              full_name: string
              private: boolean
              html_url: string
              description?: string
              default_branch: string
              updated_at: string
            }[]
          >(`/user/repos?${params}`)
          if (repos.length === 0) return { repos: [], message: "No repositories found." }
          return {
            count: repos.length,
            repos: repos.map((r) => ({
              fullName: r.full_name,
              private: r.private,
              description: r.description ?? null,
              defaultBranch: r.default_branch,
              url: r.html_url,
              updated: r.updated_at,
            })),
          }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "github-createRepo": tool({
      description:
        "Create a new GitHub repository for the authenticated user. IMPORTANT: confirm the repository name and visibility before calling this tool.",
      parameters: z.object({
        name: z.string().min(1).describe("Repository name"),
        description: z.string().optional().describe("Repository description"),
        private: z.boolean().default(false).describe("Whether the repository should be private"),
        autoInit: z.boolean().default(false).describe("Whether to initialize with a README commit"),
      }),
      execute: async (args) => {
        const { name, description, private: isPrivate, autoInit } = args
        return gateWrite(
          ctx,
          {
            connector: "github",
            action: "github-createRepo",
            risk: "write",
            title: `Create GitHub repository ${name}`,
            preview: `${isPrivate ? "Private" : "Public"} repository${description ? `: ${description}` : ""}`,
            confirmText: "Create repository",
          },
          args,
          async () => {
            try {
              const repo = await gh<{
                name: string
                full_name: string
                private: boolean
                html_url: string
                default_branch: string
              }>("/user/repos", {
                method: "POST",
                body: JSON.stringify({ name, description, private: isPrivate, auto_init: autoInit }),
              })
              return {
                ok: true,
                name: repo.name,
                fullName: repo.full_name,
                private: repo.private,
                defaultBranch: repo.default_branch,
                url: repo.html_url,
              }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "github-createOrUpdateFile": tool({
      description:
        "Create or update a single file in a GitHub repository. Provide sha when updating an existing file. IMPORTANT: confirm the path and commit message before calling this tool.",
      parameters: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        path: z.string().min(1).describe("File path within the repository"),
        content: z.string().describe("File contents"),
        message: z.string().min(1).describe("Commit message"),
        branch: z.string().optional().describe("Branch to write to. Defaults to the repository default branch"),
        sha: z.string().optional().describe("Existing file SHA, required by GitHub when updating a file"),
      }),
      execute: async (args) => {
        const { owner, repo, path, content, message, branch, sha } = args
        return gateWrite(
          ctx,
          {
            connector: "github",
            action: "github-createOrUpdateFile",
            risk: "write",
            title: `Write ${path} in ${owner}/${repo}`,
            preview: `${message}\n\n${content.slice(0, 800)}`,
            confirmText: "Commit file",
          },
          args,
          async () => {
            try {
              const params = new URLSearchParams()
              if (branch) params.set("ref", branch)
              const encodedPath = path.split("/").map(encodeURIComponent).join("/")
              const result = await gh<{
                content: { path: string; sha: string; html_url: string }
                commit: { sha: string; html_url: string }
              }>(`/repos/${owner}/${repo}/contents/${encodedPath}${params.size ? `?${params}` : ""}`, {
                method: "PUT",
                body: JSON.stringify({ message, content: base64Encode(content), branch, sha }),
              })
              return {
                ok: true,
                path: result.content.path,
                sha: result.content.sha,
                url: result.content.html_url,
                commitSha: result.commit.sha,
                commitUrl: result.commit.html_url,
              }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "github-listBranches": tool({
      description: "List branches in a GitHub repository.",
      parameters: z.object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        limit: z.number().int().min(1).max(50).default(20).describe("Max branches to return"),
      }),
      execute: async ({ owner, repo, limit }) => {
        try {
          const branches = await gh<{ name: string; protected: boolean }[]>(
            `/repos/${owner}/${repo}/branches?per_page=${limit}`,
          )
          if (branches.length === 0) return { branches: [], message: "No branches found." }
          return {
            count: branches.length,
            branches: branches.map((b) => ({ name: b.name, protected: b.protected })),
          }
        } catch (err) {
          return connectorError(err)
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
  description:
    "View and manage repositories, files, pull requests, and issues.",
  readOnlyByDefault: false,
  auth: {
    kind: "oauth2",
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    // GitHub tokens do not expire by default — no expiresAt stored
    scopes: ["repo", "read:user"],
    clientIdEnv: "GITHUB_INTEGRATIONS_CLIENT_ID",
    clientSecretEnv: "GITHUB_INTEGRATIONS_CLIENT_SECRET",
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
      { env: "GITHUB_INTEGRATIONS_CLIENT_ID", label: "GitHub Client ID", secret: false },
      { env: "GITHUB_INTEGRATIONS_CLIENT_SECRET", label: "GitHub Client Secret", secret: true },
    ],
    docsUrl: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps",
  },
  tools: createGitHubTools,
}
