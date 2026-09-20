# Google Tasks Connector

Runtime definition: Python port in progress (`apps/backend/src/yomi/connectors/`)

Runtime id: `google-tasks`

Auth: OAuth 2.0, `auth/tasks` (read + write) + user email. Sensitive scope —
brand verification, no CASA. `auth/tasks` is the broadest Tasks scope Google
offers; the only alternative is the read-only `tasks.readonly`.

Requires the **Google Tasks API** enabled in the Cloud project.

## Tools

| Tool                  | Type  | Purpose                                                    |
| --------------------- | ----- | ---------------------------------------------------------- |
| `tasks-listTaskLists` | Read  | List the user's task lists ("My Tasks", "Work", …).        |
| `tasks-listTasks`     | Read  | List tasks; hides completed by default, sorts by due date. |
| `tasks-createTask`    | Write | Create a to-do, optionally as a subtask of another.        |
| `tasks-updateTask`    | Write | Change title, notes, or due date.                          |
| `tasks-completeTask`  | Write | Mark done — or reopen with `done: false`.                  |
| `tasks-deleteTask`    | Write | Permanently delete (risk `irreversible`).                  |

All writes are approval-gated via `gateWrite`.

## Gotchas

- **Due dates are dates, not times.** Google stores `due` as RFC-3339 but
  ignores the time component entirely. `toDue()` normalises a plain `YYYY-MM-DD`
  for the model, and results are trimmed back to a date on the way out. A task
  that needs a _time_ is a calendar event, not a task — the `tasks-createTask`
  description routes the model to `calendar-createEvent` for those.
- **Reopening requires clearing the timestamp.** Patching `status: needsAction`
  alone leaves Google's `completed` timestamp in place and the task stays done;
  the tool sends `completed: null` alongside it.
- **`@default` is a real Google alias** for the user's primary list, so every
  tool takes an optional `taskListId` and falls back to it — the model never has
  to look up a list id for the common case.
