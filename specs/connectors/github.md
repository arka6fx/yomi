# GitHub Connector

Runtime definition: `packages/agent-core/src/connectors/github-def.ts`

Runtime id: `github`

Auth: OAuth 2.0 with `repo`, `read:user`, and `notifications` scopes.

## Tools

| Tool                        | Type         | Purpose                                                                                                        |
| --------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| `github-listNotifications`  | Read         | List account-level GitHub notifications, including mentions, review requests, and subscribed issue/PR updates. |
| `github-listRepos`          | Read         | List repositories the connected user can access.                                                               |
| `github-createRepo`         | Write        | Create a repository for the authenticated user.                                                                |
| `github-listBranches`       | Read         | List repository branches.                                                                                      |
| `github-createBranch`       | Write        | Create a branch from an existing branch.                                                                       |
| `github-listPRs`            | Read         | List pull requests in a repository.                                                                            |
| `github-getPR`              | Read         | Read PR details and stats.                                                                                     |
| `github-createPR`           | Write        | Open a pull request.                                                                                           |
| `github-reviewPR`           | Write        | Submit a PR review.                                                                                            |
| `github-mergePR`            | Irreversible | Merge a pull request.                                                                                          |
| `github-listIssues`         | Read         | List repository issues, excluding PRs.                                                                         |
| `github-getIssue`           | Read         | Read issue details.                                                                                            |
| `github-createIssue`        | Write        | Create an issue.                                                                                               |
| `github-updateIssue`        | Write        | Edit, close, reopen, or relabel an issue.                                                                      |
| `github-commentOnIssue`     | Write        | Comment on an issue or PR.                                                                                     |
| `github-addLabels`          | Write        | Add labels to an issue or PR.                                                                                  |
| `github-createOrUpdateFile` | Write        | Commit a single file create/update.                                                                            |

## Notes

`github-listNotifications` uses `/notifications`, not a repo-scoped endpoint, so
it can answer requests like "check my latest GitHub notifications" without
asking for a repository first.

Write and irreversible tools should use pending-action confirmation before
execution.
