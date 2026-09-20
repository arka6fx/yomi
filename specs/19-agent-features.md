# Spec 19 - Agent Features

Current agent feature set:

- AI SDK tool loop for the backend agent path.
- Connector registry for Gmail, Calendar, Drive, GitHub, Notion, Slack, Linear,
  databases, messaging, and the Composio-backed set (see
  `specs/connectors/00-index.md`).
- Cron/scheduled task tools where enabled by plan.
- Skills and plugin tools loaded from the local Yomi environment.
- Context compression for long turns, with a grace-call fall-back so a
  budget-exhausted turn still summarises its tool results instead of dumping raw
  JSON.
- Bounded subagent delegation (`delegate`): hand a self-contained sub-task to an
  isolated tool-calling loop and fold its synthesized result back into the
  transcript (ported to `apps/backend/src/yomi/services/agent/`).
- RAG ingestion and retrieval from chat: `index_text` / `index_url` /
  `index_document` write to the user's archive, `deep_research` searches it (see
  `specs/16-rag.md`).
- Backend-first Telegram handling.
- Canonical durable memory with contradiction resolution at extraction and a
  periodic embedding-only consolidation sweep that merges near-duplicate active
  memories (see `docs/adr/0006-contradiction-resolution-at-extraction.md`).

Future work should prioritize connector reliability, durable memory quality,
observability, and better retrieval over adding local app-control capabilities.
