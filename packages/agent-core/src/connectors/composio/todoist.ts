import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const TODOIST_TOOLKIT = "todoist"

export const todoistComposioSpecs: ComposioToolSpec[] = [
  // ── Read ──────────────────────────────────────────────────────
  {
    slug: "TODOIST_GET_ALL_PROJECTS",
    description: "List all projects. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "TODOIST_GET_PROJECT",
    description: "Get a specific project. Read-only.",
    parameters: z.object({ project_id: z.string().describe("Project ID") }).passthrough(),
  },
  {
    slug: "TODOIST_GET_ALL_SECTIONS",
    description: "List sections in a project. Read-only.",
    parameters: z.object({ project_id: z.string().describe("Project ID") }).passthrough(),
  },
  {
    slug: "TODOIST_GET_SECTION",
    description: "Get a specific section. Read-only.",
    parameters: z.object({ section_id: z.string().describe("Section ID") }).passthrough(),
  },
  {
    slug: "TODOIST_GET_ALL_TASKS",
    description: "List tasks, optionally filtered. Read-only.",
    parameters: z
      .object({
        filter: z.string().optional().describe("Todoist filter query, e.g. 'today', 'overdue'"),
        ids: z.array(z.string()).optional().describe("Specific task IDs"),
      })
      .passthrough(),
  },
  {
    slug: "TODOIST_GET_TASK",
    description: "Get a specific task. Read-only.",
    parameters: z.object({ task_id: z.string().describe("Task ID") }).passthrough(),
  },
  {
    slug: "TODOIST_GET_ALL_LABELS",
    description: "List all personal labels. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "TODOIST_GET_LABEL",
    description: "Get a specific label. Read-only.",
    parameters: z.object({ id: z.string().describe("Label ID") }).passthrough(),
  },
  {
    slug: "TODOIST_GET_ALL_COMMENTS",
    description: "List comments on a task or project. Read-only.",
    parameters: z
      .object({
        task_id: z.string().optional().describe("Task ID"),
        project_id: z.string().optional().describe("Project ID"),
      })
      .passthrough(),
  },
  {
    slug: "TODOIST_GET_COMMENT",
    description: "Get a specific comment. Read-only.",
    parameters: z.object({ comment_id: z.string().describe("Comment ID") }).passthrough(),
  },
  {
    slug: "TODOIST_LIST_FILTERS",
    description: "List saved filters. Read-only.",
    parameters: z.object({}).passthrough(),
  },

  // ── Write ────────────────────────────────────────────────────
  {
    slug: "TODOIST_CREATE_TASK",
    description: "Create a new task. Requires user approval before it runs.",
    parameters: z
      .object({
        content: z.string().describe("Task title"),
        project_id: z.string().optional().describe("Project ID"),
        due_string: z.string().optional().describe("Natural-language due date, e.g. 'tomorrow'"),
        priority: z.number().int().optional().describe("Priority 1-4"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create task",
      preview: `Create task "${String(a["content"] ?? "")}"`,
      confirmText: "Create task",
    }),
  },
  {
    slug: "TODOIST_UPDATE_TASK",
    description: "Update an existing task. Requires user approval before it runs.",
    parameters: z.object({ task_id: z.string().describe("Task ID") }).passthrough(),
    preview: (a) => ({
      title: "Update task",
      preview: `Update task ${String(a["task_id"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "TODOIST_CLOSE_TASK",
    description: "Mark a task as completed. Requires user approval before it runs.",
    parameters: z.object({ task_id: z.string().describe("Task ID") }).passthrough(),
    preview: (a) => ({
      title: "Complete task",
      preview: `Complete task ${String(a["task_id"] ?? "")}`,
      confirmText: "Complete",
    }),
  },
  {
    slug: "TODOIST_REOPEN_TASK",
    description: "Reopen a previously completed task. Requires user approval before it runs.",
    parameters: z.object({ task_id: z.string().describe("Task ID") }).passthrough(),
    preview: (a) => ({
      title: "Reopen task",
      preview: `Reopen task ${String(a["task_id"] ?? "")}`,
      confirmText: "Reopen",
    }),
  },
  {
    slug: "TODOIST_CREATE_PROJECT",
    description: "Create a new project. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().describe("Project name") }).passthrough(),
    preview: (a) => ({
      title: "Create project",
      preview: `Create project "${String(a["name"] ?? "")}"`,
      confirmText: "Create project",
    }),
  },
  {
    slug: "TODOIST_UPDATE_PROJECT",
    description: "Update an existing project. Requires user approval before it runs.",
    parameters: z.object({ project_id: z.string().describe("Project ID") }).passthrough(),
    preview: (a) => ({
      title: "Update project",
      preview: `Update project ${String(a["project_id"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "TODOIST_CREATE_SECTION",
    description: "Create a new section within a project. Requires user approval before it runs.",
    parameters: z
      .object({
        name: z.string().describe("Section name"),
        project_id: z.number().int().describe("Project ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Create section",
      preview: `Create section "${String(a["name"] ?? "")}"`,
      confirmText: "Create section",
    }),
  },
  {
    slug: "TODOIST_UPDATE_SECTION",
    description: "Update a section's name or order. Requires user approval before it runs.",
    parameters: z.object({ section_id: z.string().describe("Section ID") }).passthrough(),
    preview: (a) => ({
      title: "Update section",
      preview: `Update section ${String(a["section_id"] ?? "")}`,
      confirmText: "Update",
    }),
  },
  {
    slug: "TODOIST_CREATE_LABEL",
    description: "Create a new label. Requires user approval before it runs.",
    parameters: z.object({ name: z.string().describe("Label name") }).passthrough(),
    preview: (a) => ({
      title: "Create label",
      preview: `Create label "${String(a["name"] ?? "")}"`,
      confirmText: "Create label",
    }),
  },
  {
    slug: "TODOIST_CREATE_COMMENT",
    description: "Add a comment to a task or project. Requires user approval before it runs.",
    parameters: z
      .object({
        content: z.string().describe("Comment text"),
        task_id: z.string().optional().describe("Task ID"),
        project_id: z.string().optional().describe("Project ID"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Add comment",
      preview: String(a["content"] ?? "").slice(0, 100),
      confirmText: "Add comment",
    }),
  },

  // ── Irreversible ──────────────────────────────────────────────
  {
    slug: "TODOIST_DELETE_TASK",
    description: "Permanently delete a task and its subtasks. This cannot be undone.",
    parameters: z.object({ task_id: z.string().describe("Task ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete task",
      preview: `Delete task ${String(a["task_id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
  {
    slug: "TODOIST_DELETE_PROJECT",
    description: "Permanently delete a project. This cannot be undone.",
    parameters: z.object({ project_id: z.string().describe("Project ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete project",
      preview: `Delete project ${String(a["project_id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
  {
    slug: "TODOIST_DELETE_SECTION",
    description: "Permanently delete a section. This cannot be undone.",
    parameters: z.object({ section_id: z.string().describe("Section ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete section",
      preview: `Delete section ${String(a["section_id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
    }),
  },
  {
    slug: "TODOIST_DELETE_LABEL",
    description: "Permanently delete a label. This cannot be undone.",
    parameters: z.object({ label_id: z.string().describe("Label ID") }).passthrough(),
    preview: (a) => ({
      title: "Delete label",
      preview: `Delete label ${String(a["label_id"] ?? "")} — this cannot be undone`,
      confirmText: "Delete",
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
        "Create a Todoist auth config in Composio (uses OAuth)",
        "Set COMPOSIO_API_KEY and COMPOSIO_TODOIST_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=todoist to route Todoist through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        {
          env: "COMPOSIO_TODOIST_AUTH_CONFIG_ID",
          label: "Composio Todoist auth config id",
          secret: false,
        },
      ],
      docsUrl: "https://docs.composio.dev/tools/todoist",
    },
    tools: createComposioTools({
      provider: "todoist",
      toolkit: TODOIST_TOOLKIT,
      specs: todoistComposioSpecs,
      executor,
    }),
  }
}
