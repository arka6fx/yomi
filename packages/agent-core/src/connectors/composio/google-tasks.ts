import { z } from "zod"
import type { ConnectorDef } from "../connector-def.js"
import { createComposioTools, type ComposioExecutor, type ComposioToolSpec } from "./adapter.js"

export const TASKS_TOOLKIT = "googletasks"

// Every slug and param below was checked against Composio's live catalog
// (GET /api/v3/tools?toolkit_slug=googletasks). Two real bugs found:
// - CREATE_TASK doesn't exist — the real action is GOOGLETASKS_INSERT_TASK.
// - Every read/write action requires the field named exactly "tasklist_id"
//   (no underscore between "task" and "list"); the old code sent
//   "task_list_id" instead, which the real API silently ignores as an unknown
//   field — so tasklist_id (required on every one of these actions) was
//   effectively never sent and every call would 400.
// COMPLETE_TASK doesn't exist either — there's no dedicated "mark done" action.
// GOOGLETASKS_PATCH_TASK (which requires re-sending title+status even when
// unchanged, same quirk as Calendar's UPDATE_EVENT) covers both "edit a task"
// and "mark complete" (status: "completed").
export const tasksComposioSpecs: ComposioToolSpec[] = [
  // ── Read actions ──────────────────────────────────────────────
  {
    slug: "GOOGLETASKS_LIST_TASK_LISTS",
    description:
      "List the user's Google Tasks lists (e.g. 'My Tasks', 'Groceries', 'Work'). Call this first when the user names a specific list. Read-only.",
    parameters: z
      .object({
        maxResults: z.number().int().optional().describe("Max task lists per page (default 20)"),
        pageToken: z.string().optional(),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLETASKS_LIST_TASKS",
    description:
      "List tasks from a Google Tasks list. Use '@default' for tasklist_id to use the default list. Use this to answer 'what's on my to-do list' or 'what's due today'. Read-only.",
    parameters: z
      .object({
        tasklist_id: z.string().describe("Task list ID, or '@default' for the user's primary list"),
        showCompleted: z.boolean().optional().describe("Include completed tasks (default true)"),
        showHidden: z.boolean().optional(),
        showDeleted: z.boolean().optional(),
        maxResults: z
          .number()
          .int()
          .max(100)
          .optional()
          .describe("Max tasks to return (default 20)"),
        dueMin: z.string().optional().describe("Exclude tasks due before this date"),
        dueMax: z.string().optional().describe("Exclude tasks due after this date"),
      })
      .passthrough(),
  },
  {
    slug: "GOOGLETASKS_GET_TASK",
    description: "Get details of a single Google Task by its ID. Read-only.",
    parameters: z
      .object({
        tasklist_id: z.string().describe("Task list ID, or '@default' for the user's primary list"),
        task_id: z.string().describe("Task ID"),
      })
      .passthrough(),
  },

  // ── Write actions (gated) ─────────────────────────────────────
  {
    slug: "GOOGLETASKS_INSERT_TASK",
    description:
      "Create a new task in Google Tasks. Use this when the user asks to remember or track something. Requires user approval before it runs.",
    parameters: z
      .object({
        tasklist_id: z.string().describe("Task list ID, or '@default' for the user's primary list"),
        title: z.string().describe("What the task is, e.g. 'Renew passport'"),
        status: z
          .enum(["needsAction", "completed"])
          .describe("Almost always 'needsAction' for a new task"),
        notes: z.string().optional().describe("Longer detail or context for the task"),
        due: z
          .string()
          .optional()
          .describe("Due date/time, e.g. '2025-01-16T13:00:00Z' or 'UTC-5:30, 6:50 PM'"),
      })
      .passthrough(),
    preview: (a) => ({
      title: `Create task: ${String(a["title"] ?? "")}`,
      preview:
        [a["notes"] ? String(a["notes"]) : null, a["due"] ? `Due: ${String(a["due"])}` : null]
          .filter(Boolean)
          .join("\n") || String(a["title"] ?? ""),
      confirmText: "Create task",
    }),
  },
  {
    slug: "GOOGLETASKS_PATCH_TASK",
    description:
      "Update a Google Task — title, notes, due date, or status. Re-send title and status even if unchanged, the API " +
      "requires both on every patch. Set status to 'completed' to mark a task done, or 'needsAction' to reopen it. " +
      "Requires user approval before it runs.",
    parameters: z
      .object({
        tasklist_id: z.string().describe("Task list ID, or '@default' for the user's primary list"),
        task_id: z.string().describe("Task ID to update"),
        title: z.string().describe("Task title (re-send the current title if not changing it)"),
        status: z
          .enum(["needsAction", "completed"])
          .describe("Re-send the current status if not changing it"),
        notes: z.string().optional(),
        due: z.string().optional().describe("Due date/time, e.g. '2025-01-16T13:00:00Z'"),
      })
      .passthrough(),
    preview: (a) => ({
      title:
        a["status"] === "completed"
          ? "Mark task done"
          : `Update task ${String(a["task_id"] ?? "").slice(0, 12)}`,
      preview: [`Title: ${String(a["title"] ?? "")}`, a["due"] ? `Due: ${String(a["due"])}` : null]
        .filter(Boolean)
        .join("\n"),
      confirmText: a["status"] === "completed" ? "Mark done" : "Update task",
    }),
  },

  // ── Irreversible actions ──────────────────────────────────────
  {
    slug: "GOOGLETASKS_DELETE_TASK",
    description:
      "Permanently delete a Google Task. This cannot be undone. If the user finished the task, prefer completing it (GOOGLETASKS_PATCH_TASK) instead. Requires user approval before it runs.",
    parameters: z
      .object({
        tasklist_id: z.string().describe("Task list ID, or '@default' for the user's primary list"),
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
        {
          env: "COMPOSIO_TASKS_AUTH_CONFIG_ID",
          label: "Composio Tasks auth config id",
          secret: false,
        },
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
