import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const JIRA_TOOLKIT = "jira"

export const jiraComposioSpecs: ComposioToolSpec[] = [
  // ── Read / Search actions ─────────────────────────────────────
  {
    slug: "JIRA_GET_ALL_PROJECTS",
    description:
      "Get all Jira projects visible to the authenticated user. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "JIRA_GET_PROJECT",
    description:
      "Get details of a Jira project by ID or key. Read-only.",
    parameters: z
      .object({
        projectIdOrKey: z.string().describe("Project ID or project key (e.g. 'PROJ')"),
      })
      .passthrough(),
  },
  {
    slug: "JIRA_SEARCH_ISSUES",
    description:
      "Search Jira issues using structured filters or raw JQL. Read-only.",
    parameters: z
      .object({
        jql: z.string().optional().describe("JQL query string"),
        project_key: z.string().optional().describe("Filter by project key"),
        issue_type: z.string().optional().describe("Filter by issue type name"),
        status: z.string().optional().describe("Filter by status name"),
        assignee: z.string().optional().describe("Filter by assignee email or display name"),
        updated_after: z.string().optional().describe("ISO 8601 date: only issues updated after this"),
        priority: z.string().optional().describe("Filter by priority (e.g. 'High', 'Medium')"),
        labels: z.array(z.string()).optional().describe("Filter by labels"),
        max_results: z.number().int().optional().describe("Max results (default 50, max 100)"),
        fields: z.array(z.string()).optional().describe("Fields to return (e.g. 'summary', 'status', 'assignee')"),
      })
      .passthrough(),
  },
  {
    slug: "JIRA_GET_ISSUE",
    description:
      "Get a Jira issue by ID or key with customizable fields. Read-only.",
    parameters: z
      .object({
        issueIdOrKey: z.string().describe("Issue ID or key (e.g. 'PROJ-123')"),
        fields: z.array(z.string()).optional().describe("Fields to return"),
      })
      .passthrough(),
  },
  {
    slug: "JIRA_GET_ALL_STATUSES",
    description:
      "Get all issue statuses available in Jira. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "JIRA_GET_ISSUE_TYPES",
    description:
      "Get all issue types available to the user. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "JIRA_GET_COMMENT",
    description:
      "Get a specific comment by ID from a Jira issue. Read-only.",
    parameters: z
      .object({
        issueIdOrKey: z.string().describe("Issue ID or key"),
        commentId: z.string().describe("Comment ID"),
      })
      .passthrough(),
  },
  {
    slug: "JIRA_GET_COMPONENTS",
    description:
      "Get components for a Jira project. Read-only.",
    parameters: z
      .object({
        projectIdOrKey: z.string().describe("Project ID or key"),
      })
      .passthrough(),
  },
  {
    slug: "JIRA_LIST_SPRINTS",
    description:
      "Get paginated sprints from a Jira board with optional state filtering. Read-only.",
    parameters: z
      .object({
        boardId: z.string().describe("Board ID"),
        state: z.string().optional().describe("Filter by state: 'active', 'future', 'closed'"),
        maxResults: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "JIRA_GET_CURRENT_USER",
    description:
      "Get the currently authenticated Jira user's details. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "JIRA_GET_ALL_USERS",
    description:
      "Get all Jira users. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "JIRA_CHECK_PERMISSIONS",
    description:
      "Check user permissions for global and project-level operations. Read-only.",
    parameters: z
      .object({
        accountId: z.string().optional().describe("Account ID to check permissions for"),
        projectId: z.string().optional().describe("Project ID to check project-level permissions"),
        permissions: z.array(z.string()).describe("Permission keys to check (e.g. 'BROWSE_PROJECTS', 'CREATE_ISSUES')"),
      })
      .passthrough(),
  },
  {
    slug: "JIRA_SEARCH_APPROXIMATE_COUNT",
    description:
      "Count issues matching a JQL query. Fast, approximate count without retrieving details. Read-only.",
    parameters: z
      .object({
        jql: z.string().describe("JQL query (must include at least one search restriction)"),
      })
      .passthrough(),
  },
  {
    slug: "JIRA_GET_CREATE_METADATA_ISSUE_TYPE_FIELDS",
    description:
      "Get available fields for creating an issue of a specific type in a project. Read-only.",
    parameters: z
      .object({
        projectIdOrKey: z.string().describe("Project ID or key"),
        issueTypeId: z.string().describe("Issue type ID"),
      })
      .passthrough(),
  },
  {
    slug: "JIRA_PARSE_JQL_QUERIES",
    description:
      "Parse and validate JQL queries, returning the abstract syntax tree. Read-only.",
    parameters: z
      .object({
        queries: z.array(z.string()).describe("JQL queries to parse"),
      })
      .passthrough(),
  },
  {
    slug: "JIRA_GET_PERMISSIONS",
    description:
      "Get all available Jira permissions. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "JIRA_SEARCH_DASHBOARDS",
    description:
      "Search for Jira dashboards with filtering and pagination. Read-only.",
    parameters: z
      .object({
        query: z.string().optional().describe("Dashboard name search"),
        maxResults: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },

  // ── Write / Execute actions (gated) ───────────────────────────
  {
    slug: "JIRA_CREATE_ISSUE",
    description:
      "Create a new Jira issue (bug, task, story, etc.) in a project. Requires user approval before it runs.",
    parameters: z
      .object({
        project_key: z.string().describe("Project key (e.g. 'PROJ')"),
        summary: z.string().describe("Issue summary / title"),
        issue_type: z.string().describe("Issue type name (e.g. 'Bug', 'Task', 'Story')"),
        description: z.string().optional().describe("Issue description in markdown or Atlassian format"),
        priority: z.string().optional().describe("Priority name (e.g. 'High', 'Medium', 'Low')"),
        assignee: z.string().optional().describe("Assignee email or display name"),
        labels: z.array(z.string()).optional().describe("Labels to apply"),
        additional_properties: z.string().optional().describe("JSON string of custom field values"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create ${String(a["issue_type"] ?? "issue")}: ${String(a["summary"] ?? "").slice(0, 60)}`,
      preview: `Create ${String(a["issue_type"] ?? "issue")} "${String(a["summary"] ?? "").slice(0, 80)}" in ${String(a["project_key"] ?? "")}`,
      confirmText: "Create issue",
    }),
  },
  {
    slug: "JIRA_EDIT_ISSUE",
    description:
      "Update an existing Jira issue's fields. Requires user approval before it runs.",
    parameters: z
      .object({
        issueIdOrKey: z.string().describe("Issue ID or key to update"),
        summary: z.string().optional().describe("New summary"),
        description: z.string().optional().describe("New description in markdown or Atlassian format"),
        priority: z.string().optional().describe("New priority"),
        assignee: z.string().optional().describe("Assignee email or display name"),
        labels: z.array(z.string()).optional().describe("New labels"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update issue",
      preview: `Update issue ${String(a["issueIdOrKey"] ?? "")}`,
      confirmText: "Update issue",
    }),
  },
  {
    slug: "JIRA_TRANSITION_ISSUE",
    description:
      "Transition a Jira issue to a different workflow state (e.g. In Progress, Done). Requires user approval before it runs.",
    parameters: z
      .object({
        issueIdOrKey: z.string().describe("Issue ID or key to transition"),
        transition: z.string().describe("Target transition name (e.g. 'In Progress', 'Done', 'Close')"),
        assignee: z.string().optional().describe("Reassign to this user on transition"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Transition issue",
      preview: `Transition ${String(a["issueIdOrKey"] ?? "")} → ${String(a["transition"] ?? "")}`,
      confirmText: "Transition",
    }),
  },
  {
    slug: "JIRA_ASSIGN_ISSUE",
    description:
      "Assign a Jira issue to a user or unassign it. Requires user approval before it runs.",
    parameters: z
      .object({
        issueIdOrKey: z.string().describe("Issue ID or key"),
        assignee: z.string().optional().describe("Assignee email or display name (omit to unassign)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: a["assignee"] ? "Assign issue" : "Unassign issue",
      preview: a["assignee"]
        ? `Assign ${String(a["issueIdOrKey"] ?? "")} to ${String(a["assignee"] ?? "")}`
        : `Unassign ${String(a["issueIdOrKey"] ?? "")}`,
      confirmText: a["assignee"] ? "Assign" : "Unassign",
    }),
  },
  {
    slug: "JIRA_ADD_COMMENT",
    description:
      "Add a comment to a Jira issue. Requires user approval before it runs.",
    parameters: z
      .object({
        issueIdOrKey: z.string().describe("Issue ID or key"),
        body: z.string().describe("Comment body text"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add comment",
      preview: `Comment on ${String(a["issueIdOrKey"] ?? "")}`,
      confirmText: "Add comment",
    }),
  },
  {
    slug: "JIRA_UPDATE_COMMENT",
    description:
      "Update an existing Jira comment. Requires user approval before it runs.",
    parameters: z
      .object({
        issueIdOrKey: z.string().describe("Issue ID or key"),
        commentId: z.string().describe("Comment ID to update"),
        body: z.string().describe("New comment body text"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update comment",
      preview: `Update comment ${String(a["commentId"] ?? "")} on ${String(a["issueIdOrKey"] ?? "")}`,
      confirmText: "Update comment",
    }),
  },
  {
    slug: "JIRA_CREATE_ISSUE_LINK",
    description:
      "Link two Jira issues using a specified link type. Requires user approval before it runs.",
    parameters: z
      .object({
        inwardIssueKey: z.string().describe("Inward issue key (e.g. 'PROJ-123')"),
        outwardIssueKey: z.string().describe("Outward issue key (e.g. 'PROJ-456')"),
        linkType: z.string().describe("Link type name (e.g. 'Relates to', 'Blocks', 'Duplicates')"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Link issues",
      preview: `Link ${String(a["inwardIssueKey"] ?? "")} → ${String(a["linkType"] ?? "")} → ${String(a["outwardIssueKey"] ?? "")}`,
      confirmText: "Link issues",
    }),
  },
  {
    slug: "JIRA_MOVE_ISSUE_TO_SPRINT",
    description:
      "Move one or more issues to a specified active sprint. Requires user approval before it runs.",
    parameters: z
      .object({
        sprintId: z.string().describe("Sprint ID to move issues to"),
        issueIdsOrKeys: z.array(z.string()).describe("Issue IDs or keys to move"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Move to sprint",
      preview: `Move ${String((a["issueIdsOrKeys"] as Array<unknown>)?.length ?? 0)} issues to sprint ${String(a["sprintId"] ?? "")}`,
      confirmText: "Move to sprint",
    }),
  },
  {
    slug: "JIRA_CREATE_SPRINT",
    description:
      "Create a new sprint on a Jira board. Requires user approval before it runs.",
    parameters: z
      .object({
        boardId: z.string().describe("Board ID to create sprint on"),
        name: z.string().describe("Sprint name"),
        startDate: z.string().optional().describe("Start date (ISO 8601)"),
        endDate: z.string().optional().describe("End date (ISO 8601)"),
        goal: z.string().optional().describe("Sprint goal"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create sprint: ${String(a["name"] ?? "")}`,
      preview: `Create sprint "${String(a["name"] ?? "")}"${a["goal"] ? ` — ${String(a["goal"]).slice(0, 60)}` : ""}`,
      confirmText: "Create sprint",
    }),
  },
  {
    slug: "JIRA_CREATE_VERSION",
    description:
      "Create a new version/release in a Jira project. Requires user approval before it runs.",
    parameters: z
      .object({
        projectIdOrKey: z.string().describe("Project ID or key"),
        name: z.string().describe("Version name"),
        description: z.string().optional().describe("Version description"),
        releaseDate: z.string().optional().describe("Release date (ISO 8601)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create version: ${String(a["name"] ?? "")}`,
      preview: `Create version "${String(a["name"] ?? "")}" in ${String(a["projectIdOrKey"] ?? "")}`,
      confirmText: "Create version",
    }),
  },
  {
    slug: "JIRA_ADD_WORKLOG",
    description:
      "Log time spent on a Jira issue. Requires user approval before it runs.",
    parameters: z
      .object({
        issueIdOrKey: z.string().describe("Issue ID or key"),
        timeSpentSeconds: z.number().int().positive().describe("Time spent in seconds"),
        comment: z.string().optional().describe("Worklog comment"),
        started: z.string().optional().describe("When work started (ISO 8601)"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Log work",
      preview: `Log ${String(Math.round(Number(a["timeSpentSeconds"] ?? 0) / 60))}m on ${String(a["issueIdOrKey"] ?? "")}`,
      confirmText: "Log work",
    }),
  },
  {
    slug: "JIRA_BULK_CREATE_ISSUE",
    description:
      "Create multiple Jira issues at once (up to 50 per call). Requires user approval before it runs.",
    parameters: z
      .object({
        project_key: z.string().describe("Project key"),
        issues: z
          .array(
            z.object({
              summary: z.string(),
              issue_type: z.string(),
              description: z.string().optional(),
              priority: z.string().optional(),
              assignee: z.string().optional(),
              labels: z.array(z.string()).optional(),
            }),
          )
          .describe("Array of issues to create"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Bulk create ${String((a["issues"] as Array<unknown>)?.length ?? 0)} issues`,
      preview: `Create ${String((a["issues"] as Array<unknown>)?.length ?? 0)} issues in ${String(a["project_key"] ?? "")}`,
      confirmText: "Create issues",
    }),
  },

  // ── Irreversible actions (gated, flagged) ────────────────────
  {
    slug: "JIRA_DELETE_ISSUE",
    description:
      "Permanently delete a Jira issue. This action is irreversible.",
    parameters: z
      .object({
        issueIdOrKey: z.string().describe("Issue ID or key to permanently delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete issue",
      preview: `Permanently delete issue ${String(a["issueIdOrKey"] ?? "")}`,
      confirmText: "Delete issue",
    }),
  },
  {
    slug: "JIRA_DELETE_COMMENT",
    description:
      "Permanently delete a comment from a Jira issue. This action is irreversible.",
    parameters: z
      .object({
        issueIdOrKey: z.string().describe("Issue ID or key"),
        commentId: z.string().describe("Comment ID to permanently delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete comment",
      preview: `Permanently delete comment ${String(a["commentId"] ?? "")} from ${String(a["issueIdOrKey"] ?? "")}`,
      confirmText: "Delete comment",
    }),
  },
]

export function makeComposioJiraDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "jira",
    name: "Jira",
    category: "engineering",
    icon: "jira",
    description: "Manage issues, projects, sprints, and workflows in Jira (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: JIRA_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_JIRA_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Jira auth config in Composio (uses OAuth2 — no manual API key needed)",
        "Set COMPOSIO_API_KEY and COMPOSIO_JIRA_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=jira to route Jira through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_JIRA_AUTH_CONFIG_ID", label: "Composio Jira auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/jira",
    },
    tools: createComposioTools({
      provider: "jira",
      toolkit: JIRA_TOOLKIT,
      specs: jiraComposioSpecs,
      executor,
    }),
  }
}
