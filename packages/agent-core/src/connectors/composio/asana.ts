import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const ASANA_TOOLKIT = "asana"

export const asanaComposioSpecs: ComposioToolSpec[] = [
  // ── Read / Search actions ─────────────────────────────────────
  {
    slug: "ASANA_GET_A_PROJECT",
    description:
      "Get a specific Asana project by its GID. Read-only.",
    parameters: z
      .object({
        project_gid: z.string().describe("Project GID"),
        opt_fields: z.array(z.string()).optional().describe("Additional fields to include"),
      })
      .passthrough(),
  },
  {
    slug: "ASANA_GET_A_TASK",
    description:
      "Get a specific Asana task by its GID. Read-only.",
    parameters: z
      .object({
        task_gid: z.string().describe("Task GID"),
        opt_fields: z.array(z.string()).optional().describe("Additional fields to include"),
      })
      .passthrough(),
  },
  {
    slug: "ASANA_GET_ATTACHMENT",
    description:
      "Get an attachment by its GID in Asana. Read-only.",
    parameters: z
      .object({
        attachment_gid: z.string().describe("Attachment GID"),
      })
      .passthrough(),
  },
  {
    slug: "ASANA_SEARCH_TASKS_IN_WORKSPACE",
    description:
      "Search tasks across a workspace with advanced filters. Read-only.",
    parameters: z
      .object({
        workspace_gid: z.string().describe("Workspace GID"),
        project_gid: z.string().optional().describe("Filter by project"),
        assignee: z.string().optional().describe("Filter by assignee (GID or 'me')"),
        tags: z.array(z.string()).optional().describe("Filter by tag GIDs"),
        is_subtask: z.coerce.boolean().optional().describe("Filter by subtask status"),
        completed: z.coerce.boolean().optional().describe("Filter by completion status"),
        sort_by: z.string().optional().describe("Sort field: 'created_at', 'due_on', 'modified_at'"),
        sort_ascending: z.coerce.boolean().optional().describe("Sort ascending"),
        limit: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "ASANA_GET_A_USER_TASK_LIST",
    description:
      "Get the user task list for a given user. Read-only.",
    parameters: z
      .object({
        user_gid: z.string().describe("User GID or 'me'"),
        workspace_gid: z.string().optional().describe("Workspace GID"),
      })
      .passthrough(),
  },
  {
    slug: "ASANA_GET_USERS_FOR_TEAM",
    description:
      "Get all users in a team. Read-only.",
    parameters: z
      .object({
        team_gid: z.string().describe("Team GID"),
      })
      .passthrough(),
  },
  {
    slug: "ASANA_GET_USERS_FOR_WORKSPACE",
    description:
      "Get all users in a workspace or organization. Read-only.",
    parameters: z
      .object({
        workspace_gid: z.string().describe("Workspace GID"),
      })
      .passthrough(),
  },
  {
    slug: "ASANA_GET_ALL_PROJECTS",
    description:
      "Get all projects accessible to the authenticated user. Read-only.",
    parameters: z
      .object({
        workspace_gid: z.string().optional().describe("Filter by workspace"),
        team_gid: z.string().optional().describe("Filter by team"),
        archived: z.coerce.boolean().optional().describe("Include archived projects"),
        limit: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "ASANA_GET_MULTIPLE_TASKS",
    description:
      "Get multiple tasks with optional filtering. Read-only.",
    parameters: z
      .object({
        project_gid: z.string().optional().describe("Project GID"),
        section_gid: z.string().optional().describe("Section GID"),
        assignee: z.string().optional().describe("Assignee GID or 'me'"),
        completed_since: z.string().optional().describe("ISO 8601 date"),
        modified_since: z.string().optional().describe("ISO 8601 date"),
        limit: z.number().int().optional().describe("Max results"),
        opt_fields: z.array(z.string()).optional().describe("Additional fields"),
      })
      .passthrough(),
  },
  {
    slug: "ASANA_GET_SECTIONS_FOR_PROJECT",
    description:
      "Get the sections (columns) in a project. Read-only.",
    parameters: z
      .object({
        project_gid: z.string().describe("Project GID"),
        limit: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "ASANA_GET_TAGS_FOR_TASK",
    description:
      "Get all tags associated with a task. Read-only.",
    parameters: z
      .object({
        task_gid: z.string().describe("Task GID"),
      })
      .passthrough(),
  },
  {
    slug: "ASANA_GET_TAGS_FOR_WORKSPACE",
    description:
      "Get all tags in a workspace. Read-only.",
    parameters: z
      .object({
        workspace_gid: z.string().describe("Workspace GID"),
        limit: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "ASANA_GET_PROJECT_STATUS_UPDATES",
    description:
      "Get status updates for a project. Read-only.",
    parameters: z
      .object({
        project_gid: z.string().describe("Project GID"),
        limit: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "ASANA_GET_TASK_COMMENTS",
    description:
      "Get all comments (stories) on a task. Read-only.",
    parameters: z
      .object({
        task_gid: z.string().describe("Task GID"),
        limit: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "ASANA_GET_TEAMS_FOR_WORKSPACE",
    description:
      "Get all teams in a workspace. Read-only.",
    parameters: z
      .object({
        workspace_gid: z.string().describe("Workspace GID"),
        limit: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "ASANA_GET_PORTFOLIOS",
    description:
      "Get all portfolios accessible to the authenticated user. Read-only.",
    parameters: z
      .object({
        workspace_gid: z.string().describe("Workspace GID"),
        limit: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },
  {
    slug: "ASANA_GET_GOALS",
    description:
      "Get all goals accessible to the authenticated user. Read-only.",
    parameters: z
      .object({
        workspace_gid: z.string().describe("Workspace GID"),
        limit: z.number().int().optional().describe("Max results"),
      })
      .passthrough(),
  },

  // ── Write / Execute actions (gated) ───────────────────────────
  {
    slug: "ASANA_CREATE_A_TASK",
    description:
      "Create a new task in Asana. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Task name"),
        projects: z.array(z.string()).optional().describe("Project GIDs to add task to"),
        workspace: z.string().optional().describe("Workspace GID (required if no project specified)"),
        assignee: z.string().optional().describe("Assignee GID or 'me'"),
        due_on: z.string().optional().describe("Due date in YYYY-MM-DD format"),
        notes: z.string().optional().describe("Task description/notes"),
        tags: z.array(z.string()).optional().describe("Tag GIDs to apply"),
        followers: z.array(z.string()).optional().describe("Follower GIDs"),
        parent: z.string().optional().describe("Parent task GID for subtask"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create task: ${String(a["name"] ?? "").slice(0, 60)}`,
      preview: `Create task "${String(a["name"] ?? "").slice(0, 80)}"${a["assignee"] ? ` assigned to ${String(a["assignee"])}` : ""}`,
      confirmText: "Create task",
    }),
  },
  {
    slug: "ASANA_UPDATE_A_TASK",
    description:
      "Update attributes of an existing task. Requires user approval before it runs.",
    parameters: z
      .object({
        task_gid: z.string().describe("Task GID to update"),
        name: z.string().optional().describe("New task name"),
        assignee: z.string().optional().describe("Assignee GID, 'me', or null to unassign"),
        due_on: z.string().optional().describe("Due date in YYYY-MM-DD"),
        notes: z.string().optional().describe("New description"),
        completed: z.coerce.boolean().optional().describe("Mark task as completed or not"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update task",
      preview: `Update task ${String(a["task_gid"] ?? "")}`,
      confirmText: "Update task",
    }),
  },
  {
    slug: "ASANA_CREATE_SUBTASK",
    description:
      "Create a subtask under an existing parent task. Requires user approval before it runs.",
    parameters: z
      .object({
        task_gid: z.string().describe("Parent task GID"),
        name: z.string().describe("Subtask name"),
        assignee: z.string().optional().describe("Assignee GID or 'me'"),
        due_on: z.string().optional().describe("Due date in YYYY-MM-DD format"),
        notes: z.string().optional().describe("Subtask description"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create subtask: ${String(a["name"] ?? "").slice(0, 60)}`,
      preview: `Create subtask "${String(a["name"] ?? "").slice(0, 80)}" under ${String(a["task_gid"] ?? "")}`,
      confirmText: "Create subtask",
    }),
  },
  {
    slug: "ASANA_CREATE_A_PROJECT",
    description:
      "Create a new Asana project. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Project name"),
        workspace: z.string().describe("Workspace GID"),
        team: z.string().optional().describe("Team GID (required if workspace is an organization)"),
        notes: z.string().optional().describe("Project notes"),
        due_on: z.string().optional().describe("Due date in YYYY-MM-DD"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create project: ${String(a["name"] ?? "")}`,
      preview: `Create project "${String(a["name"] ?? "")}"`,
      confirmText: "Create project",
    }),
  },
  {
    slug: "ASANA_CREATE_SECTION_IN_PROJECT",
    description:
      "Create a section (column) in a project. Requires user approval before it runs.",
    parameters: z
      .object({
        project_gid: z.string().describe("Project GID"),
        name: z.string().describe("Section name"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create section: ${String(a["name"] ?? "")}`,
      preview: `Create section "${String(a["name"] ?? "")}" in project ${String(a["project_gid"] ?? "")}`,
      confirmText: "Create section",
    }),
  },
  {
    slug: "ASANA_ADD_TASK_TO_SECTION",
    description:
      "Add a task to a section (column), optionally positioning it. Requires user approval before it runs.",
    parameters: z
      .object({
        section_gid: z.string().describe("Section GID"),
        task_gid: z.string().describe("Task GID to add"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Move task to section",
      preview: `Move task ${String(a["task_gid"] ?? "")} to section ${String(a["section_gid"] ?? "")}`,
      confirmText: "Move to section",
    }),
  },
  {
    slug: "ASANA_CREATE_TASK_COMMENT",
    description:
      "Add a comment to an Asana task. Requires user approval before it runs.",
    parameters: z
      .object({
        task_gid: z.string().describe("Task GID to comment on"),
        text: z.string().describe("Comment text"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add comment",
      preview: `Comment on task ${String(a["task_gid"] ?? "")}`,
      confirmText: "Add comment",
    }),
  },
  {
    slug: "ASANA_ADD_TAG_TO_TASK",
    description:
      "Add an existing tag to a task. Requires user approval before it runs.",
    parameters: z
      .object({
        task_gid: z.string().describe("Task GID"),
        tag_gid: z.string().describe("Tag GID to add"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add tag to task",
      preview: `Add tag to task ${String(a["task_gid"] ?? "")}`,
      confirmText: "Add tag",
    }),
  },
  {
    slug: "ASANA_ADD_FOLLOWERS_TO_TASK",
    description:
      "Add followers to a task. Requires user approval before it runs.",
    parameters: z
      .object({
        task_gid: z.string().describe("Task GID"),
        followers: z.array(z.string()).describe("Array of user GIDs to add as followers"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add followers",
      preview: `Add ${String((a["followers"] as Array<unknown>)?.length ?? 0)} followers to task ${String(a["task_gid"] ?? "")}`,
      confirmText: "Add followers",
    }),
  },
  {
    slug: "ASANA_ADD_TASK_DEPENDENCIES",
    description:
      "Add dependency relationships to a task. Requires user approval before it runs.",
    parameters: z
      .object({
        task_gid: z.string().describe("Task GID to add dependencies to"),
        dependencies: z.array(z.string()).describe("Array of task GIDs that must be completed first"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add dependencies",
      preview: `Add ${String((a["dependencies"] as Array<unknown>)?.length ?? 0)} dependencies to task ${String(a["task_gid"] ?? "")}`,
      confirmText: "Add dependencies",
    }),
  },
  {
    slug: "ASANA_CREATE_PROJECT_STATUS_UPDATE",
    description:
      "Create a status update on a project. Requires user approval before it runs.",
    parameters: z
      .object({
        project_gid: z.string().describe("Project GID"),
        title: z.string().describe("Status update title"),
        text: z.string().describe("Status update body text"),
        status_type: z.string().optional().describe("Status color: 'on_track', 'at_risk', 'off_track'"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Status update",
      preview: `Post status update to project ${String(a["project_gid"] ?? "")}`,
      confirmText: "Post update",
    }),
  },
  {
    slug: "ASANA_CREATE_TAG",
    description:
      "Create a new tag in a workspace. Requires user approval before it runs.",
    parameters: z
      .object({
        workspace_gid: z.string().describe("Workspace GID"),
        name: z.string().describe("Tag name"),
        color: z.string().optional().describe("Tag color (e.g. 'light-green', 'dark-blue')"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create tag: ${String(a["name"] ?? "")}`,
      preview: `Create tag "${String(a["name"] ?? "")}"`,
      confirmText: "Create tag",
    }),
  },
  {
    slug: "ASANA_SET_PARENT_FOR_TASK",
    description:
      "Set or remove the parent of a task (make it a subtask or top-level). Requires user approval before it runs.",
    parameters: z
      .object({
        task_gid: z.string().describe("Task GID"),
        parent: z.string().nullable().optional().describe("Parent task GID, or null to remove parent"),
      })
      .passthrough(),
    preview: (a) => ({
      title: a["parent"] ? "Set parent task" : "Remove parent",
      preview: a["parent"]
        ? `Set parent of ${String(a["task_gid"] ?? "")} to ${String(a["parent"] ?? "")}`
        : `Remove parent from ${String(a["task_gid"] ?? "")}`,
      confirmText: a["parent"] ? "Set parent" : "Remove parent",
    }),
  },

  // ── Irreversible actions (gated, flagged) ────────────────────
  {
    slug: "ASANA_DELETE_TASK",
    description:
      "Permanently delete a task. This action is irreversible.",
    parameters: z
      .object({
        task_gid: z.string().describe("Task GID to permanently delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete task",
      preview: `Permanently delete task ${String(a["task_gid"] ?? "")}`,
      confirmText: "Delete task",
    }),
  },
  {
    slug: "ASANA_DELETE_PROJECT",
    description:
      "Permanently delete a project and all its tasks. This action is irreversible.",
    parameters: z
      .object({
        project_gid: z.string().describe("Project GID to permanently delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete project",
      preview: `Permanently delete project ${String(a["project_gid"] ?? "")} and all its tasks`,
      confirmText: "Delete project",
    }),
  },
  {
    slug: "ASANA_DELETE_SECTION",
    description:
      "Permanently delete a section from a project. This action is irreversible.",
    parameters: z
      .object({
        section_gid: z.string().describe("Section GID to permanently delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete section",
      preview: `Permanently delete section ${String(a["section_gid"] ?? "")}`,
      confirmText: "Delete section",
    }),
  },
  {
    slug: "ASANA_DELETE_TAG",
    description:
      "Permanently delete a tag. This action is irreversible.",
    parameters: z
      .object({
        tag_gid: z.string().describe("Tag GID to permanently delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete tag",
      preview: `Permanently delete tag ${String(a["tag_gid"] ?? "")}`,
      confirmText: "Delete tag",
    }),
  },
]

export function makeComposioAsanaDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "asana",
    name: "Asana",
    category: "productivity",
    icon: "asana",
    description: "Manage tasks, projects, sections, tags, and teams in Asana (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: ASANA_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_ASANA_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create an Asana auth config in Composio (uses OAuth2 — no manual API key needed)",
        "Set COMPOSIO_API_KEY and COMPOSIO_ASANA_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=asana to route Asana through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_ASANA_AUTH_CONFIG_ID", label: "Composio Asana auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/asana",
    },
    tools: createComposioTools({
      provider: "asana",
      toolkit: ASANA_TOOLKIT,
      specs: asanaComposioSpecs,
      executor,
    }),
  }
}
