# Spec 08 - Sidecar Agent

The sidecar agent uses the AI SDK tool loop for local desktop sessions.

Tool groups:

- Memory: add, retrieve, list, and delete durable memories; read/write/search
  local notes.
- Web: web search and URL fetch.
- System: screenshot context for the current turn and sandboxed shell
  diagnostics.
- Messaging: send messages through linked bot platforms.
- Connectors: Gmail, Calendar, Drive, GitHub, Notion, Slack, Linear, databases,
  and other registered connectors.
- Skills, cron, plugins, and delegate-task tools where enabled by plan.

Sidecar memory is local/private by default. When signed in, durable memory facts
sync to backend `/api/memory/*`.
