# Slack Connector

Runtime definition: Python port in progress (`apps/api/src/yomi/connectors/`)

Runtime id: `slack`

Auth: OAuth 2.0 user token with `search:read`, `channels:read`, `users:read`,
and `chat:write` user scopes.

## Tools

| Tool                      | Type  | Purpose                                            |
| ------------------------- | ----- | -------------------------------------------------- |
| `slack-listChannels`      | Read  | List public channels accessible to the user token. |
| `slack-searchMessages`    | Read  | Search messages across accessible channels.        |
| `slack-listUsers`         | Read  | List active non-bot workspace members.             |
| `slack-getChannelHistory` | Read  | Fetch recent messages from a channel.              |
| `slack-getThread`         | Read  | Fetch replies in a thread by timestamp.            |
| `slack-getUserInfo`       | Read  | Get user profile info by ID.                       |
| `slack-sendMessage`       | Write | Send a Slack message to a channel or DM.           |
| `slack-replyInThread`     | Write | Send a threaded reply.                             |
| `slack-uploadFile`        | Write | Upload a file to a channel.                        |

## Notes

Write tools use `gateWrite` and require explicit confirmation before execution.
