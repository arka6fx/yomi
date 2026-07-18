import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const TASKS_TOOLKIT = "googletasks"

export const tasksComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "GOOGLETASKS_LIST_TASK_LISTS",
    description:
      "List the user's Google Tasks lists (e.g. 'My Tasks', 'Groceries', 'Work'). Call this first when the user names a specific list. Read-only.",
    parameters: z.object({}).passthrough(),
  },
  {
    slug: "GOOGLETASKS_LIST_TASKS",
    description:
      "List tasks from a Google Tasks list. Omit task_list_id to use the default list. Use this to answer 'what's on my to-do list' or 'what's due today'. Read-only.",
    parameters: z
      .object({
        task_list_id: z.string().optional().describe("Task list ID (omit for the default list)"),
        include_completed: z.coerce.boolean().optional().describe("Include completed tasks"),
        max_results: z.number().int().min(1).max(100).optional().describe("Max tasks to return"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLETASKS_GET_TASK",
    description:
      "Get details of a single Google Task by its ID. Read-only.",
    parameters: z
      .object({
        task_list_id: z.string().optional().describe("Task list ID (omit for the default list)"),
        task_id: z.string().describe("Task ID"),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "GOOGLETASKS_CREATE_TASK",
    description:
      "Create a new task in Google Tasks. Use this when the user asks to remember or track something. Requires user approval before it runs.",
    parameters: z
      .object({
        task_list_id: z.string().optional().describe("Task list ID (omit for the default list)"),
        title: z.string().describe("What the task is, e.g. 'Renew passport'"),
        notes: z.string().optional().describe("Longer detail or context for the task"),
        due: z.string().optional().describe("Due date as YYYY-MM-DD"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create task: ${String(a["title"] ?? "")}`,
      preview: [a["notes"] ? String(a["notes"]) : null, a["due"] ? `Due: ${String(a["due"])}` : null].filter(Boolean).join("\n") || String(a["title"] ?? ""),
      confirmText: "Create task",
    }),
  },
  {
    slug: "GOOGLETASKS_UPDATE_TASK",
    description:
      "Update a Google Task's title, notes, or due date. Only the fields you pass are changed. Requires user approval before it runs.",
    parameters: z
      .object({
        task_list_id: z.string().optional().describe("Task list ID (omit for the default list)"),
        task_id: z.string().describe("Task ID to update"),
        title: z.string().optional().describe("New title"),
        notes: z.string().optional().describe("New notes"),
        due: z.string().optional().describe("New due date as YYYY-MM-DD"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Update task ${String(a["task_id"] ?? "").slice(0, 12)}`,
      preview: [
        a["title"] ? `Title: ${String(a["title"])}` : null,
        a["due"] ? `Due: ${String(a["due"])}` : null,
      ].filter(Boolean).join("\n") || "Update task details",
      confirmText: "Update task",
    }),
  },
  {
    slug: "GOOGLETASKS_COMPLETE_TASK",
    description:
      "Mark a Google Task as done. Pass done=false to reopen a completed task. Requires user approval before it runs.",
    parameters: z
      .object({
        task_list_id: z.string().optional().describe("Task list ID (omit for the default list)"),
        task_id: z.string().describe("Task ID to mark done"),
        done: z.coerce.boolean().optional().describe("true to complete, false to reopen"),
      })
      .passthrough(),
    preview: (a) => ({
      title: a["done"] === false ? "Reopen task" : "Mark task done",
      preview: `Task ${String(a["task_id"] ?? "").slice(0, 12)}`,
      confirmText: a["done"] === false ? "Reopen" : "Mark done",
    }),
  },

  // ── Irreversible actions ──────────────────────────────────────
  {
    slug: "GOOGLETASKS_DELETE_TASK",
    description:
      "Permanently delete a Google Task. This cannot be undone. If the user finished the task, prefer completing it instead. Requires user approval before it runs.",
    parameters: z
      .object({
        task_list_id: z.string().optional().describe("Task list ID (omit for the default list)"),
        task_id: z.string().describe("Task ID to delete"),
      })
      .passthrough(),
    preview: (a) => ({
      title: "Delete task permanently",
      preview: `Task ${String(a["task_id"] ?? "").slice(0, 12)} will be deleted. This cannot be undone.`,
      confirmText: "Delete task",
    }),
  },
]

export function makeComposioTasksDef(executor: ComposioExecutor): ConnectorDef {
  return {
    id: "google-tasks",
    name: "Google Tasks",
    category: "productivity",
    icon: "google-tasks",
    description: "Read and manage your Google Tasks to-do lists (via Composio).",
    readOnlyByDefault: false,
    auth: {
      kind: "composio",
      toolkit: TASKS_TOOLKIT,
      authConfigIdEnv: "COMPOSIO_TASKS_AUTH_CONFIG_ID",
    },
    setup: {
      providerConsoleUrl: "https://app.composio.dev",
      steps: [
        "Configure a custom Google OAuth app in Composio using your existing Google Cloud project credentials",
        "Set COMPOSIO_API_KEY and COMPOSIO_TASKS_AUTH_CONFIG_ID on the backend",
        "Set COMPOSIO_CONNECTORS=google-tasks to route Tasks through Composio",
      ],
      collect: [
        { env: "COMPOSIO_API_KEY", label: "Composio API key", secret: true },
        { env: "COMPOSIO_TASKS_AUTH_CONFIG_ID", label: "Composio Tasks auth config id", secret: false },
      ],
      docsUrl: "https://docs.composio.dev/toolkits/googletasks",
    },
    tools: createComposioTools({
      provider: "google-tasks",
      toolkit: TASKS_TOOLKIT,
      specs: tasksComposioSpecs,
      executor,
    }),
  }
}
