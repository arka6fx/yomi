import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const JIRA_TOOLKIT = "jira"

export const jiraComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  { slug: "JIRA_GET_ISSUE", description: "Get a Jira issue by ID or key. Read-only.", parameters: z.object({ issue_id_or_key: z.string().describe("Issue ID or key") }).passthrough() },
  { slug: "JIRA_SEARCH_ISSUES", description: "Search issues with structured filters or raw JQL. Read-only.", parameters: z.object({ jql: z.string().optional().describe("Raw JQL query"), project_key: z.string().optional().describe("Project key"), assignee: z.string().optional().describe("Assignee filter"), text_search: z.string().optional().describe("Free-text search") }).passthrough() },
  { slug: "JIRA_GET_ALL_PROJECTS", description: "List visible projects. Read-only.", parameters: z.object({ query: z.string().optional().describe("Filter by name/key") }).passthrough() },
  { slug: "JIRA_GET_ISSUE_TYPES", description: "List available issue types. Read-only.", parameters: z.object({}).passthrough() },
  { slug: "JIRA_GET_ALL_STATUSES", description: "List available issue statuses. Read-only.", parameters: z.object({}).passthrough() },
  { slug: "JIRA_LIST_ISSUE_COMMENTS", description: "List comments on an issue. Read-only.", parameters: z.object({ issue_id_or_key: z.string().describe("Issue ID or key") }).passthrough() },
  { slug: "JIRA_GET_TRANSITIONS", description: "List available workflow transitions for an issue. Read-only.", parameters: z.object({ issue_id_or_key: z.string().describe("Issue ID or key") }).passthrough() },
  { slug: "JIRA_GET_ISSUE_WATCHERS", description: "List users watching an issue. Read-only.", parameters: z.object({ issue_id_or_key: z.string().describe("Issue ID or key") }).passthrough() },
  { slug: "JIRA_LIST_BOARDS", description: "List Jira boards. Read-only.", parameters: z.object({ projectKeyOrId: z.string().optional().describe("Filter by project") }).passthrough() },
  { slug: "JIRA_LIST_SPRINTS", description: "List sprints on a board. Read-only.", parameters: z.object({ board_id: z.number().int().describe("Board ID"), state: z.string().optional().describe("Filter by sprint state") }).passthrough() },
  { slug: "JIRA_GET_PROJECT_VERSIONS", description: "List versions for a project. Read-only.", parameters: z.object({ project_id_or_key: z.string().describe("Project ID or key") }).passthrough() },
  { slug: "JIRA_FIND_USERS", description: "Search for Jira users by name/email to find account IDs. Read-only.", parameters: z.object({ query: z.string().optional().describe("Search query") }).passthrough() },
  { slug: "JIRA_GET_CURRENT_USER", description: "Get the authenticated user's Jira info. Read-only.", parameters: z.object({}).passthrough() },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "JIRA_CREATE_ISSUE",
    description: "Create a new Jira issue. Requires user approval before it runs.",
    parameters: z.object({ project_key: z.string().describe("Project key"), summary: z.string().describe("Issue summary"), issue_type: z.string().optional().describe("Issue type, e.g. 'Bug', 'Task'"), description: z.string().optional().describe("Issue description"), assignee: z.string().optional().describe("Assignee account ID") }).passthrough(),
    preview: (a) => ({ title: "Create issue", preview: `Create "${String(a["summary"] ?? "")}" in ${String(a["project_key"] ?? "")}`, confirmText: "Create issue" }),
  },
  {
    slug: "JIRA_EDIT_ISSUE",
    description: "Update an existing issue's fields. Requires user approval before it runs.",
    parameters: z.object({ issue_id_or_key: z.string().describe("Issue ID or key") }).passthrough(),
    preview: (a) => ({ title: "Update issue", preview: `Update issue ${String(a["issue_id_or_key"] ?? "")}`, confirmText: "Update" }),
  },
  {
    slug: "JIRA_ADD_COMMENT",
    description: "Add a comment to an issue. Requires user approval before it runs.",
    parameters: z.object({ issue_id_or_key: z.string().describe("Issue ID or key"), comment: z.string().describe("Comment text") }).passthrough(),
    preview: (a) => ({ title: "Add comment", preview: String(a["comment"] ?? "").slice(0, 100), confirmText: "Add comment" }),
  },
  {
    slug: "JIRA_ASSIGN_ISSUE",
    description: "Assign an issue to a user, or unassign it. Requires user approval before it runs.",
    parameters: z.object({ issue_id_or_key: z.string().describe("Issue ID or key"), account_id: z.string().optional().describe("Assignee account ID") }).passthrough(),
    preview: (a) => ({ title: "Assign issue", preview: `Assign issue ${String(a["issue_id_or_key"] ?? "")}`, confirmText: "Assign" }),
  },
  {
    slug: "JIRA_TRANSITION_ISSUE",
    description: "Transition an issue to a different workflow state. Requires user approval before it runs.",
    parameters: z.object({ issue_id_or_key: z.string().describe("Issue ID or key"), transition_id_or_name: z.string().describe("Transition ID or name") }).passthrough(),
    preview: (a) => ({ title: "Transition issue", preview: `Transition ${String(a["issue_id_or_key"] ?? "")}`, confirmText: "Transition" }),
  },
  {
    slug: "JIRA_CREATE_ISSUE_LINK",
    description: "Link two issues together. Requires user approval before it runs.",
    parameters: z.object({ inward_issue_key: z.string().describe("Inward issue key"), outward_issue_key: z.string().describe("Outward issue key"), link_type: z.string().describe("Link type, e.g. 'Blocks'") }).passthrough(),
    preview: (a) => ({ title: "Link issues", preview: `Link ${String(a["inward_issue_key"] ?? "")} ↔ ${String(a["outward_issue_key"] ?? "")}`, confirmText: "Link" }),
  },
  {
    slug: "JIRA_CREATE_SPRINT",
    description: "Create a new sprint on a board. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().describe("Sprint name"), origin_board_id: z.number().int().describe("Board ID") }).passthrough(),
    preview: (a) => ({ title: "Create sprint", preview: `Create sprint "${String(a["name"] ?? "")}"`, confirmText: "Create sprint" }),
  },
  {
    slug: "JIRA_ADD_ATTACHMENT",
    description: "Attach a file to an issue. Requires user approval before it runs.",
    parameters: z.object({ issue_key: z.string().describe("Issue key") }).passthrough(),
    preview: (a) => ({ title: "Add attachment", preview: `Attach file to ${String(a["issue_key"] ?? "")}`, confirmText: "Attach" }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "JIRA_DELETE_ISSUE",
    description: "Permanently delete an issue. This cannot be undone.",
    parameters: z.object({ issue_id_or_key: z.string().describe("Issue ID or key") }).passthrough(),
    preview: (a) => ({ title: "Delete issue", preview: `Delete issue ${String(a["issue_id_or_key"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
  {
    slug: "JIRA_DELETE_COMMENT",
    description: "Permanently delete a comment. This cannot be undone.",
    parameters: z.object({ issueIdOrKey: z.string().describe("Issue ID or key"), id: z.string().describe("Comment ID") }).passthrough(),
    preview: (a) => ({ title: "Delete comment", preview: `Delete comment ${String(a["id"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
]

export function makeComposioJiraDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "jira",
    name: "Jira",
    category: "engineering",
    icon: "jira",
    description: "Jira — create and manage issues, sprints, boards, and comments (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: JIRA_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_JIRA_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Jira auth config in Composio (uses OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_JIRA_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=jira to route Jira through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_JIRA_AUTH_CONFIG_ID", label: "Composio Jira auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/jira",
    },
    tools: createComposioTools({
      provider: "jira",
      toolkit: JIRA_TOOLKIT,
      specs: jiraComposioSpecs,
      executor,
    }),
  }
}
