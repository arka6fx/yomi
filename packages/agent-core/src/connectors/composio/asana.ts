import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const ASANA_TOOLKIT = "asana"

// Curated subset of Asana's real ~84-tool catalog (uses GIDs throughout).
export const asanaComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  { slug: "ASANA_GET_CURRENT_USER", description: "Get the authenticated user's Asana profile and accessible workspaces. Read-only.", parameters: z.object({}).passthrough() },
  { slug: "ASANA_GET_MULTIPLE_WORKSPACES", description: "List all accessible workspaces. Read-only.", parameters: z.object({}).passthrough() },
  { slug: "ASANA_GET_MULTIPLE_PROJECTS", description: "List projects, optionally filtered by workspace or team. Read-only.", parameters: z.object({ workspace: z.string().optional().describe("Workspace GID"), team: z.string().optional().describe("Team GID"), archived: z.boolean().optional().describe("Filter by archived status") }).passthrough() },
  { slug: "ASANA_GET_A_PROJECT", description: "Get details of a specific project. Read-only.", parameters: z.object({ project_gid: z.string().describe("Project GID") }).passthrough() },
  { slug: "ASANA_GET_SECTIONS_IN_PROJECT", description: "List sections in a project. Read-only.", parameters: z.object({ project_gid: z.string().describe("Project GID") }).passthrough() },
  { slug: "ASANA_GET_MULTIPLE_TASKS", description: "List tasks, filterable by project, section, or assignee. Read-only.", parameters: z.object({ project: z.string().optional().describe("Project GID"), section: z.string().optional().describe("Section GID"), assignee: z.string().optional().describe("Assignee GID (requires workspace)"), workspace: z.string().optional().describe("Workspace GID") }).passthrough() },
  { slug: "ASANA_GET_A_TASK", description: "Get full details of a specific task. Read-only.", parameters: z.object({ task_gid: z.string().describe("Task GID") }).passthrough() },
  { slug: "ASANA_GET_STORIES_FOR_TASK", description: "Get comments/activity (stories) for a task. Read-only.", parameters: z.object({ task_gid: z.string().describe("Task GID") }).passthrough() },
  { slug: "ASANA_GET_TAGS", description: "List tags in a workspace. Read-only.", parameters: z.object({ workspace: z.string().optional().describe("Workspace GID") }).passthrough() },
  { slug: "ASANA_GET_TAG", description: "Get details of a specific tag. Read-only.", parameters: z.object({ tag_gid: z.string().describe("Tag GID") }).passthrough() },
  { slug: "ASANA_GET_MULTIPLE_USERS", description: "List users in a workspace or team. Read-only.", parameters: z.object({ workspace: z.string().optional().describe("Workspace GID"), team: z.string().optional().describe("Team GID") }).passthrough() },
  { slug: "ASANA_GET_GOALS", description: "List goals, optionally filtered by team, project, or workspace. Read-only.", parameters: z.object({ workspace: z.string().optional().describe("Workspace GID"), team: z.string().optional().describe("Team GID") }).passthrough() },
  { slug: "ASANA_GET_GOAL", description: "Get details of a specific goal. Read-only.", parameters: z.object({ goal_gid: z.string().describe("Goal GID") }).passthrough() },
  { slug: "ASANA_GET_PORTFOLIOS", description: "List portfolios in a workspace. Read-only.", parameters: z.object({ workspace: z.string().describe("Workspace GID") }).passthrough() },
  { slug: "ASANA_GET_CUSTOM_FIELDS_FOR_WORKSPACE", description: "List custom fields defined in a workspace. Read-only.", parameters: z.object({ workspace_gid: z.string().describe("Workspace GID") }).passthrough() },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "ASANA_CREATE_A_PROJECT",
    description: "Create a new project. Requires user approval before it runs.",
    parameters: z.object({ data: z.record(z.string(), z.unknown()).describe("Project fields, must include 'name' plus 'workspace' or 'team'") }).passthrough(),
    preview: () => ({ title: "Create project", preview: "Create a new Asana project", confirmText: "Create project" }),
  },
  {
    slug: "ASANA_CREATE_A_TASK",
    description: "Create a new task. Requires user approval before it runs.",
    parameters: z.object({ data: z.record(z.string(), z.unknown()).describe("Task fields, must include 'name' plus 'workspace', 'parent', or 'projects'") }).passthrough(),
    preview: () => ({ title: "Create task", preview: "Create a new Asana task", confirmText: "Create task" }),
  },
  {
    slug: "ASANA_CREATE_SUBTASK",
    description: "Create a subtask under an existing task. Requires user approval before it runs.",
    parameters: z.object({ task_gid: z.string().describe("Parent task GID"), name: z.string().describe("Subtask name") }).passthrough(),
    preview: (a) => ({ title: "Create subtask", preview: `Create subtask "${String(a["name"] ?? "")}"`, confirmText: "Create subtask" }),
  },
  {
    slug: "ASANA_CREATE_SECTION_IN_PROJECT",
    description: "Create a new section in a project. Requires user approval before it runs.",
    parameters: z.object({ project_gid: z.string().describe("Project GID"), name: z.string().describe("Section name") }).passthrough(),
    preview: (a) => ({ title: "Create section", preview: `Create section "${String(a["name"] ?? "")}"`, confirmText: "Create section" }),
  },
  {
    slug: "ASANA_ADD_TASK_TO_SECTION",
    description: "Add an existing task to a section. Requires user approval before it runs.",
    parameters: z.object({ task_gid: z.string().describe("Task GID"), section_gid: z.string().describe("Section GID") }).passthrough(),
    preview: (a) => ({ title: "Add task to section", preview: `Add task ${String(a["task_gid"] ?? "")} to section ${String(a["section_gid"] ?? "")}`, confirmText: "Add" }),
  },
  {
    slug: "ASANA_CREATE_TASK_COMMENT",
    description: "Add a comment to a task. Requires user approval before it runs.",
    parameters: z.object({ task_id: z.string().describe("Task GID"), text: z.string().describe("Comment text") }).passthrough(),
    preview: (a) => ({ title: "Add comment", preview: String(a["text"] ?? "").slice(0, 100), confirmText: "Add comment" }),
  },
  {
    slug: "ASANA_ADD_FOLLOWERS_TO_TASK",
    description: "Add followers to a task. Requires user approval before it runs.",
    parameters: z.object({ task_gid: z.string().describe("Task GID"), followers: z.array(z.string()).describe("User GIDs to add as followers") }).passthrough(),
    preview: (a) => ({ title: "Add followers", preview: `Add followers to task ${String(a["task_gid"] ?? "")}`, confirmText: "Add" }),
  },
  {
    slug: "ASANA_CREATE_A_TAG_IN_A_WORKSPACE",
    description: "Create a new tag in a workspace. Requires user approval before it runs.",
    parameters: z.object({ workspace_gid: z.string().describe("Workspace GID"), data: z.record(z.string(), z.unknown()).describe("Tag fields (name, color)") }).passthrough(),
    preview: () => ({ title: "Create tag", preview: "Create a new tag", confirmText: "Create tag" }),
  },
  {
    slug: "ASANA_CREATE_PROJECT_STATUS_UPDATE",
    description: "Post a status update on a project. Requires user approval before it runs.",
    parameters: z.object({ project_gid: z.string().describe("Project GID"), title: z.string().describe("Status title"), text: z.string().describe("Status text"), color: z.string().describe("Status color"), status_type: z.string().describe("Status type") }).passthrough(),
    preview: (a) => ({ title: "Post status update", preview: String(a["title"] ?? "").slice(0, 100), confirmText: "Post" }),
  },
  {
    slug: "ASANA_UPDATE_A_TASK",
    description: "Update an existing task's fields. Requires user approval before it runs.",
    parameters: z.object({ task_gid: z.string().describe("Task GID"), data: z.record(z.string(), z.unknown()).describe("Fields to update") }).passthrough(),
    preview: (a) => ({ title: "Update task", preview: `Update task ${String(a["task_gid"] ?? "")}`, confirmText: "Update" }),
  },
  {
    slug: "ASANA_UPDATE_PROJECT",
    description: "Update an existing project's fields. Requires user approval before it runs.",
    parameters: z.object({ project_gid: z.string().describe("Project GID"), data: z.record(z.string(), z.unknown()).describe("Fields to update") }).passthrough(),
    preview: (a) => ({ title: "Update project", preview: `Update project ${String(a["project_gid"] ?? "")}`, confirmText: "Update" }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "ASANA_DELETE_TASK",
    description: "Permanently delete a task. This cannot be undone.",
    parameters: z.object({ task_gid: z.string().describe("Task GID") }).passthrough(),
    preview: (a) => ({ title: "Delete task", preview: `Delete task ${String(a["task_gid"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
  {
    slug: "ASANA_DELETE_PROJECT",
    description: "Permanently delete a project. This cannot be undone.",
    parameters: z.object({ project_gid: z.string().describe("Project GID") }).passthrough(),
    preview: (a) => ({ title: "Delete project", preview: `Delete project ${String(a["project_gid"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
  {
    slug: "ASANA_DELETE_TAG",
    description: "Permanently delete a tag. This cannot be undone.",
    parameters: z.object({ tag_gid: z.string().describe("Tag GID") }).passthrough(),
    preview: (a) => ({ title: "Delete tag", preview: `Delete tag ${String(a["tag_gid"] ?? "")} — this cannot be undone`, confirmText: "Delete" }),
  },
]

export function makeComposioAsanaDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "asana",
    name: "Asana",
    category: "productivity",
    icon: "asana",
    description: "Asana — manage projects, tasks, sections, tags, goals, and status updates (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: ASANA_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_ASANA_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create an Asana auth config in Composio (uses OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_ASANA_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=asana to route Asana through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_ASANA_AUTH_CONFIG_ID", label: "Composio Asana auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/tools/asana",
    },
    tools: createComposioTools({
      provider: "asana",
      toolkit: ASANA_TOOLKIT,
      specs: asanaComposioSpecs,
      executor,
    }),
  }
}
