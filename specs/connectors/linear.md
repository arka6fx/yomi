# Linear Connector

Runtime definitions: `packages/agent-core/src/connectors/linear-def.ts`

Runtime ids: `linear`, `linear-api-key`

Auth: OAuth 2.0 with `read` and `write`, or a personal API key. Both variants
expose the same tools.

## Tools

| Tool                  | Type  | Purpose                                                      |
| --------------------- | ----- | ------------------------------------------------------------ |
| `linear-listIssues`   | Read  | List issues with optional team, assignee, and state filters. |
| `linear-getIssue`     | Read  | Read issue details and recent comments.                      |
| `linear-createIssue`  | Write | Create an issue in a team.                                   |
| `linear-updateIssue`  | Write | Change state, priority, assignee, project, or labels.        |
| `linear-addComment`   | Write | Add a comment to an issue.                                   |
| `linear-listTeams`    | Read  | List workspace teams.                                        |
| `linear-listProjects` | Read  | List projects, optionally filtered by name.                  |
| `linear-listLabels`   | Read  | List available issue labels.                                 |

## Notes

Create and comment operations use pending-action confirmation. Update operations
should also require confirmation before execution.
