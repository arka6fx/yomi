import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const GITHUB_TOOLKIT = "github"

export const githubComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "GITHUB_LIST_REPOSITORY_ISSUES",
    description:
      "List issues in a GitHub repository. Optionally filter by state (open, closed) or label. Read-only.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner (username or org)"),
        repo: z.string().describe("Repository name"),
        state: z.enum(["open", "closed", "all"]).optional().describe("Issue state filter"),
        labels: z.string().optional().describe("Comma-separated label names to filter by"),
        per_page: z.number().int().min(1).max(100).optional().describe("Max issues to return"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_GET_AN_ISSUE",
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
    slug: "GITHUB_FIND_PULL_REQUESTS",
    description:
      "Search pull requests across GitHub with smart filtering by repo, author, state, and labels. Build a query like 'repo:owner/name state:open'. Read-only.",
    parameters: z
      .object({
        query: z.string().describe("Search query for PR title, description, or commit messages"),
        owner: z.string().optional().describe("Filter by repository owner"),
        repo: z.string().optional().describe("Filter by repository (owner/repo format)"),
        state: z.enum(["open", "closed", "all"]).optional().describe("Filter by PR state"),
        per_page: z.number().int().min(1).max(100).optional().describe("Max results to return"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_GET_A_PULL_REQUEST",
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
    slug: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
    description: "List repositories for the authenticated user. Read-only.",
    parameters: z
      .object({
        per_page: z.number().int().min(1).max(100).optional().describe("Max repos to return"),
        sort: z.enum(["created", "updated", "pushed", "full_name"]).optional(),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_GET_A_REPOSITORY",
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
    slug: "GITHUB_GET_REPOSITORY_CONTENT",
    description:
      "Get a file's base64-encoded content, or a directory's metadata, from a GitHub repository path. Read-only.",
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
    slug: "GITHUB_LIST_REPOSITORY_WORKFLOWS",
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
    slug: "GITHUB_GET_A_WORKFLOW",
    description: "Get details for a specific GitHub Actions workflow. Read-only.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        workflow_id: z.number().int().optional().describe("Workflow numeric ID"),
        workflow_name: z.string().optional().describe("Workflow filename, e.g. ci.yml"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY",
    description:
      "List workflow runs for a repository, optionally filtered by branch, status, or event. Read-only.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        branch: z.string().optional().describe("Filter by branch name"),
        status: z
          .string()
          .optional()
          .describe("Filter by status/conclusion, e.g. success, in_progress"),
        per_page: z.number().int().min(1).max(100).optional().describe("Max runs to return"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_LIST_NOTIFICATIONS_FOR_THE_AUTHENTICATED_USER",
    description: "List notifications for the authenticated user. Read-only.",
    parameters: z
      .object({
        all: z.coerce.boolean().optional().describe("Include already-read notifications"),
        participating: z.coerce
          .boolean()
          .optional()
          .describe("Only notifications the user is participating in"),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max notifications to return"),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_SEARCH_CODE",
    description: "Search code file contents and paths across GitHub repositories. Read-only.",
    parameters: z
      .object({
        q: z.string().describe("Code search query, e.g. 'language:ts useEffect'"),
        per_page: z.number().int().min(1).max(100).optional(),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
    description:
      "Search issues and pull requests across GitHub using GitHub's search qualifiers. Read-only.",
    parameters: z
      .object({
        q: z.string().describe("Search query, e.g. 'repo:owner/name is:open label:bug'"),
        per_page: z.number().int().min(1).max(100).optional(),
      })
      .passthrough(),
  },
  {
    slug: "GITHUB_GET_A_COMMIT",
    description: "Get a single commit from a GitHub repository. Read-only.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        ref: z.string().describe("Commit SHA, branch, or tag"),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "GITHUB_CREATE_AN_ISSUE",
    description:
      "Create a new issue in a GitHub repository. Requires user approval before it runs.",
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
    slug: "GITHUB_UPDATE_AN_ISSUE",
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
      preview: [
        a["state"] ? `State: ${String(a["state"])}` : null,
        a["title"] ? `Title: ${String(a["title"])}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      confirmText: "Update issue",
    }),
  },
  {
    slug: "GITHUB_CREATE_AN_ISSUE_COMMENT",
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
    slug: "GITHUB_CREATE_A_PULL_REQUEST",
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
    slug: "GITHUB_UPDATE_A_PULL_REQUEST",
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
    slug: "GITHUB_MERGE_A_PULL_REQUEST",
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
    slug: "GITHUB_CREATE_A_REVIEW_FOR_A_PULL_REQUEST",
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
    slug: "GITHUB_ADD_LABELS_TO_AN_ISSUE",
    description:
      "Add labels to a GitHub issue or pull request. Requires user approval before it runs.",
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
    slug: "GITHUB_CREATE_A_REFERENCE",
    description:
      "Create a new branch (git reference) in a GitHub repository from an existing commit SHA. Requires user approval before it runs.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        ref: z.string().describe("Fully qualified ref to create, e.g. refs/heads/my-branch"),
        sha: z.string().describe("SHA of an existing commit the new ref should point to"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create ref ${String(a["ref"] ?? "")} in ${String(a["owner"] ?? "")}/${String(a["repo"] ?? "")}`,
      preview: `${String(a["ref"] ?? "")} @ ${String(a["sha"] ?? "").slice(0, 12)}`,
      confirmText: "Create branch",
    }),
  },
  {
    slug: "GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS",
    description:
      "Create or update a single file in a GitHub repository. Content must be base64-encoded. Requires user approval before it runs.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        path: z.string().describe("File path within the repository"),
        content: z.string().describe("Base64-encoded file contents"),
        message: z.string().describe("Commit message"),
        branch: z.string().optional().describe("Branch to write to"),
        sha: z.string().optional().describe("Existing file blob SHA (required when updating)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Write ${String(a["path"] ?? "")} in ${String(a["owner"] ?? "")}/${String(a["repo"] ?? "")}`,
      preview: String(a["message"] ?? ""),
      confirmText: "Commit file",
    }),
  },
  {
    slug: "GITHUB_CREATE_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER",
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
    slug: "GITHUB_MARK_A_THREAD_AS_READ",
    description:
      "Mark a single notification thread as read. Requires user approval before it runs.",
    parameters: z
      .object({
        thread_id: z.number().int().describe("Notification thread ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Mark notification read",
      preview: `Mark notification ${String(a["thread_id"] ?? "")} as read`,
      confirmText: "Mark as read",
    }),
  },
  {
    slug: "GITHUB_CREATE_A_WORKFLOW_DISPATCH_EVENT",
    description:
      "Manually trigger a GitHub Actions workflow run. Requires user approval before it runs.",
    parameters: z
      .object({
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        workflow_id: z.number().int().describe("Numeric workflow ID"),
        ref: z.string().describe("Branch or tag to run the workflow on"),
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
        {
          env: "COMPOSIO_GITHUB_AUTH_CONFIG_ID",
          label: "Composio GitHub auth config id",
          secret: false,
        },
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
