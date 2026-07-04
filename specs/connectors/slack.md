# Slack Connector

Runtime definition: `packages/agent-core/src/connectors/slack-def.ts`

Runtime id: `slack`

Auth: OAuth 2.0 user token with `search:read`, `channels:read`, `users:read`,
and `chat:write` user scopes.

## Tools

| Tool                   | Type  | Purpose                                            |
| ---------------------- | ----- | -------------------------------------------------- |
| `slack-listChannels`   | Read  | List public channels accessible to the user token. |
| `slack-searchMessages` | Read  | Search messages across accessible channels.        |
| `slack-listUsers`      | Read  | List active non-bot workspace members.             |
| `slack-sendMessage`    | Write | Send a Slack message to a channel or DM.           |

## Notes

`slack-sendMessage` requires explicit confirmation before execution.
