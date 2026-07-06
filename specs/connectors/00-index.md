# Connectors

This folder tracks the connector surface area that Yomi exposes to the agent
loop. Each connector spec lists the current tool names, read/write behavior,
auth requirements, and known gaps.

Runtime definitions live in `packages/agent-core/src/connectors/*-def.ts` and
are registered through `packages/agent-core/src/connectors/all-defs.ts`.

## Registered connectors

| Connector        | Runtime id         | Spec                  | Status                                  |
| ---------------- | ------------------ | --------------------- | --------------------------------------- |
| Google Gmail     | `google`           | `google-gmail.md`     | Implemented                             |
| Google Calendar  | `google-calendar`  | `google-calendar.md`  | Implemented                             |
| Google Drive     | `google-drive`     | `google-drive.md`     | Implemented                             |
| Google Classroom | `google-classroom` | `google-classroom.md` | Implemented, read-write (gated writes)  |
| GitHub           | `github`           | `github.md`           | Implemented                             |
| Notion           | `notion`           | `notion.md`           | Implemented                             |
| Slack            | `slack`            | `slack.md`            | Implemented                             |
| Linear OAuth     | `linear`           | `linear.md`           | Implemented                             |
| Linear API Key   | `linear-api-key`   | `linear.md`           | Implemented, same tools as Linear OAuth |

## Confirmation rule

Tools that create, update, send, delete, merge, archive, or otherwise mutate
user data must require confirmation before the mutation. Prefer the shared
pending-action gate where available; otherwise the tool must block until an
explicit confirmation argument is supplied.

The sidecar supplies `createPendingAction` (queueing into the per-conversation
`PendingActionManager`, persisted under `~/.yomi/state/`), so `gateWrite()`
gates writes on desktop exactly as the backend gates Telegram writes. Approval
synonyms ("yes", "/approve", …) are intercepted before intent routing and
replay the stored tool call — see `apps/sidecar/src/conversation/`.
