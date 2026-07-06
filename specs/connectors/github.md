# GitHub Connector

Runtime definition: `packages/agent-core/src/connectors/github-def.ts`

Runtime id: `github`

Auth: OAuth 2.0 with `repo`, `read:user`, and `notifications` scopes.

## Tools

| Tool                              | Type         | Purpose                                                                                                        |
| --------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| `github-listNotifications`        | Read         | List account-level GitHub notifications.                                                                       |
| `github-getNotificationSubject`   | Read         | Resolve a notification subject to readable details.                                                            |
| `github-markNotificationRead`     | Write        | Mark one notification thread as read.                                                                          |
| `github-markAllNotificationsRead` | Write        | Mark all notifications as read.                                                                                |
| `github-listRepos`                | Read         | List repositories the connected user can access.                                                               |
| `github-createRepo`               | Write        | Create a repository for the authenticated user.                                                                |
| `github-listBranches`             | Read         | List repository branches.                                                                                      |
| `github-createBranch`             | Write        | Create a branch from an existing branch.                                                                       |
| `github-listPRs`                  | Read         | List pull requests in a repository.                                                                            |
| `github-getPR`                    | Read         | Read PR details and stats.                                                                                     |
| `github-createPR`                 | Write        | Open a pull request.                                                                                           |
| `github-reviewPR`                 | Write        | Submit a PR review.                                                                                            |
| `github-mergePR`                  | Irreversible | Merge a pull request.                                                                                          |
| `github-listIssues`               | Read         | List repository issues, excluding PRs.                                                                         |
| `github-getIssue`                 | Read         | Read issue details.                                                                                            |
| `github-createIssue`              | Write        | Create an issue.                                                                                               |
| `github-updateIssue`              | Write        | Edit, close, reopen, or relabel an issue.                                                                      |
| `github-commentOnIssue`           | Write        | Comment on an issue or PR.                                                                                     |
| `github-addLabels`                | Write        | Add labels to an issue or PR.                                                                                  |
| `github-createOrUpdateFile`       | Write        | Commit a single file create/update.                                                                            |
| `github-getFileContents`          | Read         | Read a file from a repository.                                                                                 |
| `github-listCommits`              | Read         | List commits on a branch.                                                                                      |
| `github-listWorkflows`            | Read         | List GitHub Actions workflows for a repository.                                                                |

## Notes

- `github-listNotifications` uses `/notifications`, not a repo-scoped endpoint.
- Write and irreversible tools use `gateWrite` and require user confirmation.
