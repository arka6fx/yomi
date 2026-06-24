# Spec 19 - Agent Features

Current agent feature set:

- AI SDK tool loop for sidecar and backend agent paths.
- Connector registry for Gmail, Calendar, Drive, GitHub, Notion, Slack, Linear, databases, and messaging.
- Cron/scheduled task tools where enabled by plan.
- Skills and plugin tools loaded from the local Yomi environment.
- Context compression for long turns.
- Backend-first Telegram handling.
- Canonical durable memory with local sidecar sync.

Future work should prioritize connector reliability, durable memory quality, observability, and better retrieval over adding local app-control capabilities.
