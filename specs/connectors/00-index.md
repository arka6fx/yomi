# Connectors

This folder tracks the connector surface area that Yomi exposes to the agent
loop. Each connector spec lists the current tool names, read/write behavior,
auth requirements, and known gaps.

Runtime definitions live in `packages/agent-core/src/connectors/*-def.ts` and
are registered through `packages/agent-core/src/connectors/all-defs.ts`.

## Registered connectors

| Connector        | Runtime id         | Spec                  | Tools | Status                                  |
| ---------------- | ------------------ | --------------------- | ----: | --------------------------------------- |
| Google Gmail     | `google`           | `google-gmail.md`     |    18 | Implemented                             |
| Google Calendar  | `google-calendar`  | `google-calendar.md`  |    10 | Implemented                             |
| Google Drive     | `google-drive`     | `google-drive.md`     |    19 | Implemented                             |
| Google Classroom | `google-classroom` | `google-classroom.md` |     6 | Implemented, read-write (gated writes)  |
| Google Tasks     | `google-tasks`     | `google-tasks.md`     |     6 | Implemented                             |
| Google Meet      | `google-meet`      | `google-meet.md`      |     7 | Implemented                             |
| GitHub           | `github`           | `github.md`           |    23 | Implemented                             |
| Notion           | `notion`           | `notion.md`           |    12 | Implemented                             |
| Slack            | `slack`            | `slack.md`            |     9 | Implemented                             |
| Linear OAuth     | `linear`           | `linear.md`           |    12 | Implemented                             |
| Linear API Key   | `linear-api-key`   | `linear.md`           |    12 | Implemented, same tools as Linear OAuth |

## Confirmation rule

Tools that create, update, send, delete, merge, archive, or otherwise mutate
user data must require confirmation before the mutation. Prefer the shared
pending-action gate where available; otherwise the tool must block until an
explicit confirmation argument is supplied.

The desktop client and its sidecar are retired (see
`docs/adr/0002-retire-desktop-telegram-only.md`) — Telegram is the only
interaction surface now. `gateWrite()` gates writes backend-side via
`apps/backend/src/services/pending-actions.ts`. Approval synonyms ("yes",
"/approve", …) are intercepted before intent routing and replay the stored
tool call.
