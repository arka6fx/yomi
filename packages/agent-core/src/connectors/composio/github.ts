import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const GITHUB_TOOLKIT = "github"

export const githubComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "GITHUB_LIST_ISSUES",
    description:
      "List issues in a GitHub repository. Optionally filter by state (open, closed) or label. Read-only.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner (username or org)"),
        repo: z.string().describe("Repository name"),
        state: z.enum(["open", "closed", "all"]).optional().describe("Issue state filter"),
        label: z.string().optional().describe("Filter by label name"),
        per_page: z.number().int().min(1).max(100).optional().describe("Max issues to return"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_GET_ISSUE",
    description: "Get full details for a specific GitHub issue. Read-only.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        issue_number: z.number().int().describe("Issue number"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_LIST_PULL_REQUESTS",
    description: "List pull requests in a GitHub repository. Optionally filter by state. Read-only.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        state: z.enum(["open", "closed", "all"]).optional().describe("PR state filter"),
        per_page: z.number().int().min(1).max(100).optional().describe("Max PRs to return"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_GET_PULL_REQUEST",
    description: "Get full details for a specific GitHub pull request. Read-only.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        pull_number: z.number().int().describe("Pull request number"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_LIST_REPOSITORIES",
    description: "List repositories for the authenticated user. Read-only.",
    parameters: z
      .object({
        per_page: z.number().int().min(1).max(100).optional().describe("Max repos to return"),
        sort: z.enum(["created", "updated", "pushed", "full_name"]).optional(),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_GET_REPOSITORY",
    description: "Get details for a specific repository. Read-only.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_LIST_BRANCHES",
    description: "List branches in a GitHub repository. Read-only.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        per_page: z.number().int().min(1).max(100).optional().describe("Max branches to return"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_LIST_COMMITS",
    description: "List commits in a GitHub repository branch. Read-only.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        sha: z.string().optional().describe("Branch or commit SHA to list from"),
        per_page: z.number().int().min(1).max(100).optional().describe("Max commits to return"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_GET_FILE_CONTENTS",
    description: "Get file or directory contents from a GitHub repository. Read-only.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        path: z.string().describe("File path within the repository"),
        ref: z.string().optional().describe("Branch name or commit SHA"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_LIST_WORKFLOWS",
    description: "List GitHub Actions workflows in a repository. Read-only.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        per_page: z.number().int().min(1).max(100).optional().describe("Max workflows to return"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_GET_WORKFLOW",
    description: "Get details for a specific GitHub Actions workflow. Read-only.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        workflow_id: z.union([z.number().int(), z.string()]).describe("Workflow ID or filename"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_LIST_WORKFLOW_RUNS",
    description: "List runs for a GitHub Actions workflow. Read-only.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        workflow_id: z.union([z.number().int(), z.string()]).describe("Workflow ID or filename"),
        per_page: z.number().int().min(1).max(100).optional().describe("Max runs to return"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_LIST_NOTIFICATIONS",
    description: "List notifications for the authenticated user. Read-only.",
    parameters: z
      .object({
        all: z.coerce.boolean().optional().describe("Include read notifications"),
        participating: z.coerce.boolean().optional().describe("Only participating"),
        per_page: z.number().int().min(1).max(100).optional().describe("Max notifications to return"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_SEARCH_CODE",
    description: "Search code across GitHub repositories. Read-only.",
    parameters: z
      .object({
        q: z.string().describe("Search query"),
        per_page: z.number().int().min(1).max(100).optional(),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_SEARCH_ISSUES",
    description: "Search issues and pull requests across GitHub. Read-only.",
    parameters: z
      .object({
        q: z.string().describe("Search query"),
        per_page: z.number().int().min(1).max(100).optional(),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_GET_COMMIT",
    description: "Get a single commit from a GitHub repository. Read-only.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        ref: z.string().describe("Commit SHA or ref"),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "GITHUB_CREATE_ISSUE",
    description: "Create a new issue in a GitHub repository. Requires user approval before it runs.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        title: z.string().describe("Issue title"),
        body: z.string().optional().describe("Issue body (markdown)"),
        labels: z.array(z.string()).optional().describe("Label names to apply"),
        assignees: z.array(z.string()).optional().describe("GitHub usernames to assign"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create GitHub issue: ${String(a["owner"] ?? "")}/${String(a["repo"] ?? "")}`,
      preview: [String(a["title"] ?? ""), String(a["body"] ?? "").slice(0, 800)]
        .filter(Boolean)
        .join("\n\n"),
      confirmText: "Create issue",
    }),
  },
  {
    slug: "GITHUB_UPDATE_ISSUE",
    description:
      "Update a GitHub issue: close/reopen it or edit its title, body, or labels. Requires user approval before it runs.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        issue_number: z.number().int().describe("Issue number"),
        state: z.enum(["open", "closed"]).optional().describe("Set state"),
        title: z.string().optional().describe("New title"),
        body: z.string().optional().describe("New body (markdown)"),
        labels: z.array(z.string()).optional().describe("Replace labels with this set"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Update GitHub issue ${String(a["owner"] ?? "")}/${String(a["repo"] ?? "")}#${String(a["issue_number"] ?? "")}`,
      preview: [a["state"] ? `State: ${String(a["state"])}` : null, a["title"] ? `Title: ${String(a["title"])}` : null]
        .filter(Boolean)
        .join("\n"),
      confirmText: "Update issue",
    }),
  },
  {
    slug: "GITHUB_COMMENT_ON_ISSUE",
    description:
      "Add a comment to a GitHub issue or pull request. Requires user approval before it runs.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        issue_number: z.number().int().describe("Issue or pull request number"),
        body: z.string().describe("Comment body (markdown)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Comment on ${String(a["owner"] ?? "")}/${String(a["repo"] ?? "")}#${String(a["issue_number"] ?? "")}`,
      preview: String(a["body"] ?? "").slice(0, 800),
      confirmText: "Post comment",
    }),
  },
  {
    slug: "GITHUB_CREATE_PULL_REQUEST",
    description:
      "Open a new pull request in a GitHub repository. Requires user approval before it runs.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        title: z.string().describe("Pull request title"),
        head: z.string().describe("Branch with changes"),
        base: z.string().describe("Branch to merge into"),
        body: z.string().optional().describe("PR description (markdown)"),
        draft: z.coerce.boolean().optional().describe("Open as a draft PR"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Open PR in ${String(a["owner"] ?? "")}/${String(a["repo"] ?? "")}: ${String(a["head"] ?? "")} → ${String(a["base"] ?? "")}`,
      preview: [String(a["title"] ?? ""), String(a["body"] ?? "").slice(0, 800)]
        .filter(Boolean)
        .join("\n\n"),
      confirmText: "Open pull request",
    }),
  },
  {
    slug: "GITHUB_UPDATE_PULL_REQUEST",
    description:
      "Update a pull request's title, body, state, or base branch. Requires user approval before it runs.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        pull_number: z.number().int().describe("Pull request number"),
        title: z.string().optional(),
        body: z.string().optional(),
        state: z.enum(["open", "closed"]).optional(),
        base: z.string().optional().describe("New base branch"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Update PR ${String(a["owner"] ?? "")}/${String(a["repo"] ?? "")}#${String(a["pull_number"] ?? "")}`,
      preview: JSON.stringify(a).slice(0, 800),
      confirmText: "Update pull request",
    }),
  },
  {
    slug: "GITHUB_MERGE_PULL_REQUEST",
    description:
      "Merge a GitHub pull request. This CANNOT be undone. Requires user approval before it runs.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        pull_number: z.number().int().describe("Pull request number"),
        merge_method: z.enum(["merge", "squash", "rebase"]).optional().describe("Merge strategy"),
        commit_title: z.string().optional(),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Merge ${String(a["owner"] ?? "")}/${String(a["repo"] ?? "")}#${String(a["pull_number"] ?? "")}`,
      preview: `Merge pull request #${String(a["pull_number"] ?? "")}. This CANNOT be undone.`,
      confirmText: "Merge pull request",
    }),
  },
  {
    slug: "GITHUB_SUBMIT_PULL_REQUEST_REVIEW",
    description:
      "Submit a review on a pull request (approve, request changes, comment). Requires user approval before it runs.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        pull_number: z.number().int().describe("Pull request number"),
        event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).describe("Review verdict"),
        body: z.string().optional().describe("Review comment"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `${String(a["event"] ?? "")} review on ${String(a["owner"] ?? "")}/${String(a["repo"] ?? "")}#${String(a["pull_number"] ?? "")}`,
      preview: String(a["body"] ?? a["event"] ?? ""),
      confirmText: "Submit review",
    }),
  },
  {
    slug: "GITHUB_ADD_LABELS_TO_ISSUE",
    description: "Add labels to a GitHub issue or pull request. Requires user approval before it runs.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        issue_number: z.number().int().describe("Issue or pull request number"),
        labels: z.array(z.string()).min(1).describe("Label names to add"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Add labels to ${String(a["owner"] ?? "")}/${String(a["repo"] ?? "")}#${String(a["issue_number"] ?? "")}`,
      preview: `Labels: ${String((a["labels"] as string[])?.join(", ") ?? "")}`,
      confirmText: "Add labels",
    }),
  },
  {
    slug: "GITHUB_CREATE_BRANCH",
    description:
      "Create a new branch in a GitHub repository from an existing branch. Requires user approval before it runs.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        branch: z.string().describe("New branch name"),
        from_branch: z.string().optional().describe("Branch to fork from (defaults to default branch)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create branch ${String(a["branch"] ?? "")} in ${String(a["owner"] ?? "")}/${String(a["repo"] ?? "")}`,
      preview: `${String(a["branch"] ?? "")} ← ${String(a["from_branch"] ?? "default")}`,
      confirmText: "Create branch",
    }),
  },
  {
    slug: "GITHUB_CREATE_OR_UPDATE_FILE",
    description:
      "Create or update a single file in a GitHub repository. Requires user approval before it runs.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        path: z.string().describe("File path within the repository"),
        content: z.string().describe("File contents"),
        message: z.string().describe("Commit message"),
        branch: z.string().optional().describe("Branch to write to"),
        sha: z.string().optional().describe("Existing file SHA (required when updating)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Write ${String(a["path"] ?? "")} in ${String(a["owner"] ?? "")}/${String(a["repo"] ?? "")}`,
      preview: `${String(a["message"] ?? "")}\n\n${String(a["content"] ?? "").slice(0, 800)}`,
      confirmText: "Commit file",
    }),
  },
  {
    slug: "GITHUB_CREATE_REPOSITORY",
    description:
      "Create a new GitHub repository for the authenticated user. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Repository name"),
        description: z.string().optional(),
        private: z.coerce.boolean().optional().describe("Whether private"),
        auto_init: z.coerce.boolean().optional().describe("Initialize with README"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create GitHub repository ${String(a["name"] ?? "")}`,
      preview: `${a["private"] ? "Private" : "Public"} repository`,
      confirmText: "Create repository",
    }),
  },
  {
    slug: "GITHUB_MARK_NOTIFICATION_READ",
    description:
      "Mark a single notification thread as read. Requires user approval before it runs.",
    parameters: z
      .object({
        thread_id: z.string().describe("Notification thread ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Mark notification read",
      preview: `Mark notification ${String(a["thread_id"] ?? "")} as read`,
      confirmText: "Mark as read",
    }),
  },
  {
    slug: "GITHUB_CREATE_WORKFLOW_DISPATCH",
    description:
      "Trigger a GitHub Actions workflow run via repository_dispatch. Requires user approval before it runs.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        workflow_id: z.union([z.number().int(), z.string()]).describe("Workflow ID or filename"),
        ref: z.string().describe("Branch to run the workflow on"),
        inputs: z.record(z.string()).optional().describe("Workflow input parameters"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Trigger workflow in ${String(a["owner"] ?? "")}/${String(a["repo"] ?? "")}`,
      preview: `Workflow ${String(a["workflow_id"] ?? "")} on ${String(a["ref"] ?? "")}`,
      confirmText: "Trigger workflow",
    }),
  },
]

export function makeComposioGitHubDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "github",
    name: "GitHub",
    category: "engineering",
    icon: "github",
    description: "View and manage repositories, files, pull requests, and issues (via Composio).",
    readOnlyByDefault: false,
    auth: {
      kind: "composio",
      toolkit: GITHUB_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_GITHUB_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a GitHub auth config in Composio (or use the managed one)",
        "Set COMPOSIO_API_KEY and COMPOSIO_GITHUB_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=github to route GitHub through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_GITHUB_AUTH_CONFIG_ID", label: "Composio GitHub auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/github",
    },
    tools: createComposioTools({
      provider: "github",
      toolkit: GITHUB_TOOLKIT,
      specs: githubComposioSpecs,
      executor,
    }),
  }
}
