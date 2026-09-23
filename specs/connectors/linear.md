# Linear Connector

Runtime definition: Python port in progress (`apps/api/src/yomi/connectors/`)

Runtime id: `linear`

Auth: OAuth 2.0 with `read` and `write` scopes.

## Tools

| Tool                  | Type         | Purpose                                                      |
| --------------------- | ------------ | ------------------------------------------------------------ |
| `linear-listIssues`   | Read         | List issues with optional team, assignee, and state filters. |
| `linear-getIssue`     | Read         | Read issue details and recent comments.                      |
| `linear-listTeams`    | Read         | List workspace teams.                                        |
| `linear-listProjects` | Read         | List projects, optionally filtered by name.                  |
| `linear-listLabels`   | Read         | List available issue labels.                                 |
| `linear-listStates`   | Read         | List valid workflow states per team.                         |
| `linear-listCycles`   | Read         | List cycles with start/end dates and progress.               |
| `linear-createIssue`  | Write        | Create an issue in a team.                                   |
| `linear-updateIssue`  | Write        | Change state, priority, assignee, project, or labels.        |
| `linear-addComment`   | Write        | Add a comment to an issue.                                   |
| `linear-createLabel`  | Write        | Create a new label.                                          |
| `linear-deleteIssue`  | Irreversible | Delete an issue.                                             |

## Notes

Write operations use `gateWrite` and require user confirmation. `deleteIssue` is
flagged as `"irreversible"`.
