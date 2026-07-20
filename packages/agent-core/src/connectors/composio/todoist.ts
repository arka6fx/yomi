import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const TODOIST_TOOLKIT = "todoist"

export const todoistComposioSpecs: ComposioToolSpec[] = [
  // ── Read / Search actions ─────────────────────────────────────
  {
    slug: "TODOIST_GET_ALL_PROJECTS",
    description:
      "Get all projects in Todoist. Returns project metadata including id, name, color, and parent. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "TODOIST_GET_PROJECT",
    description:
      "Get a specific project by ID. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID"),
      })
      .passthrough(),
  },
  {
    slug: "TODOIST_GET_ALL_TASKS",
    description:
      "Get all active (incomplete) tasks. Supports filtering by project, label, priority, and date. Read-only.",
    parameters: z
      .object({
        filter: z.string().optional().describe("Filter query (e.g. 'today', 'overdue', '#ProjectName', 'p1', 'search: keyword')"),
        limit: z.number().int().optional().describe("Max results per page"),
        cursor: z.string().optional().describe("Pagination cursor"),
      })
      .passthrough(),
  },
  {
    slug: "TODOIST_GET_TASK2",
    description:
      "Get a single active task by ID. Read-only.",
    parameters: z
      .object({
        task_id: z.string().describe("Task ID"),
      })
      .passthrough(),
  },
  {
    slug: "TODOIST_FILTER_TASKS",
    description:
      "Get all tasks matching a specific filter. Supports cursor-based pagination. Read-only.",
    parameters: z
      .object({
        filter: z.string().describe("Filter query"),
        limit: z.number().int().optional().describe("Max results per page"),
        cursor: z.string().optional().describe("Pagination cursor"),
      })
      .passthrough(),
  },
  {
    slug: "TODOIST_LIST_SECTIONS",
    description:
      "Get all sections in a project. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID to list sections from"),
      })
      .passthrough(),
  },
  {
    slug: "TODOIST_GET_SECTION_V1",
    description:
      "Get a specific section by ID. Read-only.",
    parameters: z
      .object({
        section_id: z.string().describe("Section ID"),
      })
      .passthrough(),
  },
  {
    slug: "TODOIST_LIST_LABELS",
    description:
      "Get all personal labels. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "TODOIST_GET_ALL_COMMENTS",
    description:
      "Get all comments for a task or project. Read-only.",
    parameters: z
      .object({
        task_id: z.string().optional().describe("Task ID to get comments for"),
        project_id: z.string().optional().describe("Project ID to get comments for"),
      })
      .passthrough(),
  },
  {
    slug: "TODOIST_LIST_COMPLETED_TASKS",
    description:
      "Get completed tasks with optional project filtering. Read-only.",
    parameters: z
      .object({
        project_id: z.string().optional().describe("Optional project ID to filter by"),
        limit: z.number().int().optional().describe("Max results"),
        cursor: z.string().optional().describe("Pagination cursor"),
      })
      .passthrough(),
  },
  {
    slug: "TODOIST_GET_USER",
    description:
      "Get the authenticated user's profile and settings. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "TODOIST_GET_PRODUCTIVITY_STATS",
    description:
      "Get productivity statistics including karma score, streaks, and goal tracking. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "TODOIST_GET_PROJECT_FULL",
    description:
      "Get full project data including all tasks, sections, and collaborators. Read-only.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID"),
      })
      .passthrough(),
  },
  {
    slug: "TODOIST_LIST_ACTIVITIES",
    description:
      "List recent activity log events. Read-only.",
    parameters: z
      .object({
        limit: z.number().int().optional().describe("Max results"),
        cursor: z.string().optional().describe("Pagination cursor"),
      })
      .passthrough(),
  },
  {
    slug: "TODOIST_SEARCH_LABELS",
    description:
      "Search user labels by name with case-insensitive matching. Read-only.",
    parameters: z
      .object({
        query: z.string().describe("Label name to search for"),
      })
      .passthrough(),
  },
  {
    slug: "TODOIST_GET_ID_MAPPINGS",
    description:
      "Get ID mappings for temporary IDs used in sync. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "TODOIST_LIST_FILTERS",
    description:
      "List all saved filters. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "TODOIST_LIST_ARCHIVED_PROJECTS",
    description:
      "List all archived projects. Read-only.",
    parameters: z.object({}).passthrough(),
  },

  // ── Write / Execute actions (gated) ───────────────────────────
  {
    slug: "TODOIST_CREATE_TASK",
    description:
      "Create a new task in Todoist. Supports content, due dates, priority, project, section, and parent task. Requires user approval before it runs.",
    parameters: z
      .object({
        content: z.string().describe("Task content/description"),
        due_string: z.string().optional().describe("Natural language due date (e.g. 'tomorrow at 3pm')"),
        due_date: z.string().optional().describe("Due date in YYYY-MM-DD format"),
        priority: z.number().int().min(1).max(4).optional().describe("Priority: 1 (urgent) to 4 (low)"),
        project_id: z.string().optional().describe("Project ID to add task to"),
        section_id: z.string().optional().describe("Section ID to add task to"),
        parent_id: z.string().optional().describe("Parent task ID for subtask"),
        labels: z.array(z.string()).optional().describe("Label names to apply"),
        description: z.string().optional().describe("Task description/markdown notes"),
        due_datetime: z.string().optional().describe("Due datetime in RFC 3339 format"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create task: ${String(a["content"] ?? "").slice(0, 60)}`,
      preview: `Create task "${String(a["content"] ?? "").slice(0, 80)}"${a["due_string"] ? ` due ${String(a["due_string"])}` : ""}`,
      confirmText: "Create task",
    }),
  },
  {
    slug: "TODOIST_QUICK_ADD_TASK",
    description:
      "Quick-add a task using natural language parsing (dates, projects, labels, priority in one string). Requires user approval before it runs.",
    parameters: z
      .object({
        text: z.string().describe("Natural language task text (e.g. 'Buy groceries tomorrow #Personal p1')"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Quick add: ${String(a["text"] ?? "").slice(0, 60)}`,
      preview: `Quick add task "${String(a["text"] ?? "").slice(0, 80)}"`,
      confirmText: "Quick add",
    }),
  },
  {
    slug: "TODOIST_UPDATE_TASK",
    description:
      "Update an existing task's properties (content, due date, priority, labels, etc.). Requires user approval before it runs.",
    parameters: z
      .object({
        task_id: z.string().describe("Task ID to update"),
        content: z.string().optional().describe("New task content"),
        due_string: z.string().optional().describe("Natural language due date"),
        due_date: z.string().optional().describe("Due date in YYYY-MM-DD format"),
        priority: z.number().int().min(1).max(4).optional().describe("Priority"),
        labels: z.array(z.string()).optional().describe("Label names"),
        description: z.string().optional().describe("Task description"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update task",
      preview: `Update task ${String(a["task_id"] ?? "")}${a["content"] ? ` → "${String(a["content"]).slice(0, 60)}"` : ""}`,
      confirmText: "Update task",
    }),
  },
  {
    slug: "TODOIST_CLOSE_TASK_V1",
    description:
      "Close (complete) a task. Requires user approval before it runs.",
    parameters: z
      .object({
        task_id: z.string().describe("Task ID to close"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Complete task",
      preview: `Mark task ${String(a["task_id"] ?? "")} as complete`,
      confirmText: "Complete task",
    }),
  },
  {
    slug: "TODOIST_REOPEN_TASK2",
    description:
      "Reopen a completed task. Requires user approval before it runs.",
    parameters: z
      .object({
        task_id: z.string().describe("Task ID to reopen"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Reopen task",
      preview: `Reopen task ${String(a["task_id"] ?? "")}`,
      confirmText: "Reopen task",
    }),
  },
  {
    slug: "TODOIST_CREATE_PROJECT2",
    description:
      "Create a new project with specified name, color, and parent. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Project name"),
        color: z.string().optional().describe("Color name or hex"),
        parent_id: z.string().optional().describe("Parent project ID for sub-projects"),
        favorite: z.coerce.boolean().optional().describe("Mark as favorite"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create project: ${String(a["name"] ?? "")}`,
      preview: `Create project "${String(a["name"] ?? "")}"`,
      confirmText: "Create project",
    }),
  },
  {
    slug: "TODOIST_CREATE_SECTION_V1",
    description:
      "Create a new section within a project. Requires user approval before it runs.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID to add section to"),
        name: z.string().describe("Section name"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create section: ${String(a["name"] ?? "")}`,
      preview: `Create section "${String(a["name"] ?? "")}" in project ${String(a["project_id"] ?? "")}`,
      confirmText: "Create section",
    }),
  },
  {
    slug: "TODOIST_CREATE_LABEL_V1",
    description:
      "Create a new personal label. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Label name"),
        color: z.string().optional().describe("Label color"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create label: ${String(a["name"] ?? "")}`,
      preview: `Create label "${String(a["name"] ?? "")}"`,
      confirmText: "Create label",
    }),
  },
  {
    slug: "TODOIST_CREATE_COMMENT_V1",
    description:
      "Add a comment to a task or project. Requires user approval before it runs.",
    parameters: z
      .object({
        task_id: z.string().optional().describe("Task ID to comment on (mutually exclusive with project_id)"),
        project_id: z.string().optional().describe("Project ID to comment on (mutually exclusive with task_id)"),
        content: z.string().describe("Comment text"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add comment",
      preview: `Add comment to ${a["task_id"] ? `task ${String(a["task_id"])}` : `project ${String(a["project_id"])}`}`,
      confirmText: "Add comment",
    }),
  },
  {
    slug: "TODOIST_MOVE_TASK",
    description:
      "Move a task to another project, section, or parent task. Requires user approval before it runs.",
    parameters: z
      .object({
        task_id: z.string().describe("Task ID to move"),
        project_id: z.string().optional().describe("Target project ID"),
        section_id: z.string().optional().describe("Target section ID"),
        parent_id: z.string().optional().describe("Target parent task ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Move task",
      preview: `Move task ${String(a["task_id"] ?? "")} to ${a["project_id"] ? `project ${String(a["project_id"])}` : a["section_id"] ? `section ${String(a["section_id"])}` : "new parent"}`,
      confirmText: "Move task",
    }),
  },
  {
    slug: "TODOIST_UPDATE_PROJECT2",
    description:
      "Update a project's properties (name, color, favorite, etc.). Requires user approval before it runs.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID to update"),
        name: z.string().optional().describe("New project name"),
        color: z.string().optional().describe("New color"),
        favorite: z.coerce.boolean().optional().describe("Mark as favorite"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Update project",
      preview: `Update project ${String(a["project_id"] ?? "")}${a["name"] ? ` → "${String(a["name"])}"` : ""}`,
      confirmText: "Update project",
    }),
  },
  {
    slug: "TODOIST_BULK_CREATE_TASKS",
    description:
      "Create multiple tasks at once using Sync batching. Requires user approval before it runs.",
    parameters: z
      .object({
        tasks: z
          .array(
            z.object({
              content: z.string(),
              due_string: z.string().optional(),
              priority: z.number().int().min(1).max(4).optional(),
              project_id: z.string().optional(),
              section_id: z.string().optional(),
              labels: z.array(z.string()).optional(),
            }),
          )
          .describe("Array of tasks to create"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Bulk create ${String((a["tasks"] as Array<unknown>)?.length ?? 0)} tasks`,
      preview: `Create ${String((a["tasks"] as Array<unknown>)?.length ?? 0)} tasks in Todoist`,
      confirmText: "Create tasks",
    }),
  },
  {
    slug: "TODOIST_ARCHIVE_PROJECT2",
    description:
      "Archive a project. For personal projects, archives for the user. For workspace projects, archives for all members. Requires user approval before it runs.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID to archive"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Archive project",
      preview: `Archive project ${String(a["project_id"] ?? "")}`,
      confirmText: "Archive project",
    }),
  },

  // ── Irreversible actions (gated, flagged) ────────────────────
  {
    slug: "TODOIST_DELETE_TASK",
    description:
      "Permanently delete a task and all its subtasks. No recycle bin or undo. This action is irreversible.",
    parameters: z
      .object({
        task_id: z.string().describe("Task ID to permanently delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete task",
      preview: `Permanently delete task ${String(a["task_id"] ?? "")} and all subtasks`,
      confirmText: "Delete task",
    }),
  },
  {
    slug: "TODOIST_DELETE_PROJECT2",
    description:
      "Permanently delete a project, all its sections, and all tasks within them. This action is irreversible.",
    parameters: z
      .object({
        project_id: z.string().describe("Project ID to permanently delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete project",
      preview: `Permanently delete project ${String(a["project_id"] ?? "")} and all contents`,
      confirmText: "Delete project",
    }),
  },
  {
    slug: "TODOIST_DELETE_SECTION2",
    description:
      "Permanently delete a section and all tasks within it. This action is irreversible.",
    parameters: z
      .object({
        section_id: z.string().describe("Section ID to permanently delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete section",
      preview: `Permanently delete section ${String(a["section_id"] ?? "")} and all tasks`,
      confirmText: "Delete section",
    }),
  },
  {
    slug: "TODOIST_DELETE_COMMENT",
    description:
      "Permanently delete a comment. This action is irreversible.",
    parameters: z
      .object({
        comment_id: z.string().describe("Comment ID to permanently delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete comment",
      preview: `Permanently delete comment ${String(a["comment_id"] ?? "")}`,
      confirmText: "Delete comment",
    }),
  },
]

export function makeComposioTodoistDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "todoist",
    name: "Todoist",
    category: "productivity",
    icon: "todoist",
    description:
      "Manage tasks, projects, sections, labels, and comments in Todoist (via Composio).",
    readOnlyByDefault: true,
    auth: {
      kind: "composio",
      toolkit: TODOIST_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_TODOIST_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Create a Todoist auth config in Composio (uses OAuth2 — no manual API key needed)",
        "Set COMPOSIO_API_KEY and COMPOSIO_TODOIST_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=todoist to route Todoist through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_TODOIST_AUTH_CONFIG_ID", label: "Composio Todoist auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/todoist",
    },
    tools: createComposioTools({
      provider: "todoist",
      toolkit: TODOIST_TOOLKIT,
      specs: todoistComposioSpecs,
      executor,
    }),
  }
}
