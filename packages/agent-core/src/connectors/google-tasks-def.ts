import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { ConnectorDef, ConnectorContext } from "./connector-def.js"
import { connectorError, gateWrite } from "./connector-def.js"

interface GoogleTask {
  id: string
  title?: string
  notes?: string
  status?: "needsAction" | "completed"
  due?: string
  completed?: string
  parent?: string
  updated?: string
}

// Google Tasks stores `due` as an RFC-3339 timestamp but ignores the time part —
// only the date is honoured. Accept a plain date from the model and normalise.
function toDue(due: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return `${due}T00:00:00.000Z`
  return new Date(due).toISOString()
}

function shapeTask(t: GoogleTask) {
  return {
    id: t.id,
    title: t.title ?? "(untitled)",
    notes: t.notes,
    done: t.status === "completed",
    due: t.due ? t.due.slice(0, 10) : undefined,
    subtaskOf: t.parent,
  }
}

export function createTasksTools(ctx: ConnectorContext): ToolSet {
  async function tasksApi<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await ctx.getAccessToken(ctx.userId, "google-tasks")
    const res = await fetch(`https://tasks.googleapis.com/tasks/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Tasks API ${path} → ${res.status}: ${body.slice(0, 200)}`)
    }
    // DELETE and completion writes return 204 No Content.
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  // Every task belongs to a list. The model rarely knows the id, so an omitted
  // list resolves to the user's default ("@default" is a Google alias for it).
  const DEFAULT_LIST = "@default"

  return {
    "tasks-listTaskLists": tool({
      description:
        "List the user's Google Tasks lists (e.g. 'My Tasks', 'Groceries', 'Work'). Call this first " +
        "when the user names a specific list; omit the list everywhere else and the default list is used.",
      parameters: z.object({}),
      execute: async () => {
        try {
          const data = await tasksApi<{ items?: { id: string; title?: string }[] }>(
            "/users/@me/lists?maxResults=100",
          )
          const lists = (data.items ?? []).map((l) => ({
            id: l.id,
            title: l.title ?? "(untitled)",
          }))
          if (lists.length === 0) return { lists: [], message: "No task lists found." }
          return { count: lists.length, lists }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "tasks-listTasks": tool({
      description:
        "List tasks (to-dos) from a Google Tasks list. Use this to answer 'what's on my to-do list', " +
        "'what's due today', or 'what haven't I finished'. Completed tasks are hidden unless you ask " +
        "for them. Get taskListId from tasks-listTaskLists, or omit it to use the default list.",
      parameters: z.object({
        taskListId: z
          .string()
          .optional()
          .describe("Task list ID from tasks-listTaskLists. Omit for the default list."),
        includeCompleted: z
          .boolean()
          .default(false)
          .describe("Include tasks already marked done (default: false)"),
        dueBefore: z
          .string()
          .optional()
          .describe("Only tasks due on or before this date (YYYY-MM-DD), e.g. for 'due this week'"),
        maxResults: z.number().int().min(1).max(100).default(50).describe("Max tasks to return"),
      }),
      execute: async ({ taskListId, includeCompleted, dueBefore, maxResults }) => {
        try {
          const params = new URLSearchParams({
            maxResults: String(maxResults),
            showCompleted: String(includeCompleted),
            showHidden: String(includeCompleted),
          })
          if (dueBefore) params.set("dueMax", toDue(dueBefore))
          const data = await tasksApi<{ items?: GoogleTask[] }>(
            `/lists/${taskListId ?? DEFAULT_LIST}/tasks?${params}`,
          )
          const tasks = (data.items ?? []).map(shapeTask)
          if (tasks.length === 0) return { tasks: [], message: "No tasks found." }
          // Undated tasks sort last; otherwise soonest first.
          tasks.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))
          return { count: tasks.length, tasks }
        } catch (err) {
          return connectorError(err)
        }
      },
    }),

    "tasks-createTask": tool({
      description:
        "Create a to-do in Google Tasks. Use this when the user asks to remember, track, or be " +
        "reminded to DO something with no specific time — for a timed commitment with a start and " +
        "end, create a calendar event instead (calendar-createEvent).",
      parameters: z.object({
        title: z.string().describe("What the task is, e.g. 'Renew passport'"),
        notes: z.string().optional().describe("Longer detail or context for the task"),
        due: z
          .string()
          .optional()
          .describe("Due date as YYYY-MM-DD. Google Tasks honours the date only, never a time."),
        taskListId: z
          .string()
          .optional()
          .describe("Task list ID from tasks-listTaskLists. Omit for the default list."),
        parentTaskId: z
          .string()
          .optional()
          .describe("Make this a subtask of an existing task with this ID"),
      }),
      execute: async (args) => {
        const { title, notes, due, taskListId, parentTaskId } = args
        return gateWrite(
          ctx,
          {
            connector: "google-tasks",
            action: "tasks-createTask",
            risk: "write",
            title: `Create task: ${title}`,
            preview: [notes, due ? `Due: ${due}` : null].filter(Boolean).join("\n") || title,
            confirmText: "Create task",
          },
          args,
          async () => {
            try {
              const params = parentTaskId ? `?${new URLSearchParams({ parent: parentTaskId })}` : ""
              const body: Record<string, unknown> = { title }
              if (notes) body["notes"] = notes
              if (due) body["due"] = toDue(due)
              const created = await tasksApi<GoogleTask>(
                `/lists/${taskListId ?? DEFAULT_LIST}/tasks${params}`,
                { method: "POST", body: JSON.stringify(body) },
              )
              return { ok: true, ...shapeTask(created), message: "Task created." }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "tasks-completeTask": tool({
      description:
        "Mark a Google Task as done. Get the taskId from tasks-listTasks first — never guess it. " +
        "Pass done=false to reopen a task that was completed by mistake.",
      parameters: z.object({
        taskId: z.string().describe("Task ID from tasks-listTasks"),
        taskListId: z
          .string()
          .optional()
          .describe("Task list ID the task belongs to. Omit for the default list."),
        done: z.boolean().default(true).describe("true to complete, false to reopen"),
      }),
      execute: async (args) => {
        const { taskId, taskListId, done } = args
        return gateWrite(
          ctx,
          {
            connector: "google-tasks",
            action: "tasks-completeTask",
            risk: "write",
            title: done ? "Mark a task done" : "Reopen a task",
            preview: `Task ${taskId}`,
            confirmText: done ? "Mark done" : "Reopen",
          },
          args,
          async () => {
            try {
              // Clearing `completed` alongside status is required to reopen — Google
              // keeps the old completion timestamp otherwise and the task stays done.
              const updated = await tasksApi<GoogleTask>(
                `/lists/${taskListId ?? DEFAULT_LIST}/tasks/${taskId}`,
                {
                  method: "PATCH",
                  body: JSON.stringify({
                    status: done ? "completed" : "needsAction",
                    ...(done ? {} : { completed: null }),
                  }),
                },
              )
              return {
                ok: true,
                ...shapeTask(updated),
                message: done ? "Task marked done." : "Task reopened.",
              }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "tasks-updateTask": tool({
      description:
        "Change a Google Task's title, notes, or due date. Only the fields you pass are changed. " +
        "To mark a task done use tasks-completeTask; to remove it entirely use tasks-deleteTask.",
      parameters: z.object({
        taskId: z.string().describe("Task ID from tasks-listTasks"),
        taskListId: z.string().optional().describe("Task list ID. Omit for the default list."),
        title: z.string().optional().describe("New title"),
        notes: z.string().optional().describe("New notes (replaces the existing notes)"),
        due: z.string().optional().describe("New due date as YYYY-MM-DD"),
      }),
      execute: async (args) => {
        const { taskId, taskListId, title, notes, due } = args
        return gateWrite(
          ctx,
          {
            connector: "google-tasks",
            action: "tasks-updateTask",
            risk: "write",
            title: `Update task ${title ? `→ ${title}` : taskId}`,
            preview: [
              title ? `Title: ${title}` : null,
              notes ? `Notes: ${notes}` : null,
              due ? `Due: ${due}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
            confirmText: "Update task",
          },
          args,
          async () => {
            try {
              const body: Record<string, unknown> = {}
              if (title !== undefined) body["title"] = title
              if (notes !== undefined) body["notes"] = notes
              if (due !== undefined) body["due"] = toDue(due)
              if (Object.keys(body).length === 0) {
                return { error: "Nothing to update — pass a title, notes, or due date." }
              }
              const updated = await tasksApi<GoogleTask>(
                `/lists/${taskListId ?? DEFAULT_LIST}/tasks/${taskId}`,
                { method: "PATCH", body: JSON.stringify(body) },
              )
              return { ok: true, ...shapeTask(updated), message: "Task updated." }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),

    "tasks-deleteTask": tool({
      description:
        "Permanently delete a Google Task. This cannot be undone — if the user finished the task, " +
        "prefer tasks-completeTask so it stays in their history.",
      parameters: z.object({
        taskId: z.string().describe("Task ID from tasks-listTasks"),
        taskListId: z.string().optional().describe("Task list ID. Omit for the default list."),
      }),
      execute: async (args) => {
        const { taskId, taskListId } = args
        return gateWrite(
          ctx,
          {
            connector: "google-tasks",
            action: "tasks-deleteTask",
            risk: "irreversible",
            title: "Delete a task permanently",
            preview: `Task ${taskId} will be deleted. This cannot be undone.`,
            confirmText: "Delete task",
          },
          args,
          async () => {
            try {
              await tasksApi(`/lists/${taskListId ?? DEFAULT_LIST}/tasks/${taskId}`, {
                method: "DELETE",
              })
              return { ok: true, message: "Task deleted." }
            } catch (err) {
              return connectorError(err)
            }
          },
        )
      },
    }),
  }
}

export const googleTasksDef: ConnectorDef = {
  id: "google-tasks",
  name: "Google Tasks",
  category: "productivity",
  icon: "google-tasks",
  description:
    "Read and manage your Google Tasks to-do lists — list what's due, create tasks and subtasks, change due dates, and mark them done.",
  readOnlyByDefault: false,
  auth: {
    kind: "oauth2",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      // Read + write on tasks. This is the broadest Tasks scope there is — the only
      // alternative is the read-only tasks.readonly. Sensitive, not restricted: it
      // needs brand verification but no CASA assessment.
      "https://www.googleapis.com/auth/tasks",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    clientIdEnv: "GOOGLE_INTEGRATIONS_CLIENT_ID",
    clientSecretEnv: "GOOGLE_INTEGRATIONS_CLIENT_SECRET",
    redirectPath: "/api/integrations/callback/google-tasks",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  setup: {
    providerConsoleUrl: "https://console.cloud.google.com/apis/credentials",
    steps: [
      "Use the same Google Cloud project as Gmail (GOOGLE_INTEGRATIONS_CLIENT_ID)",
      "Enable Google Tasks API under APIs & Services → Library",
      "Add Authorized Redirect URI: ${BACKEND_URL}/api/integrations/callback/google-tasks",
      "The tasks scope is sensitive — requires Google brand verification before non-test users can connect",
    ],
    collect: [
      {
        env: "GOOGLE_INTEGRATIONS_CLIENT_ID",
        label: "Google Client ID (same as Gmail)",
        secret: false,
      },
      { env: "GOOGLE_INTEGRATIONS_CLIENT_SECRET", label: "Google Client Secret", secret: true },
    ],
    docsUrl: "https://developers.google.com/tasks/reference/rest",
  },
  tools: createTasksTools,
}
