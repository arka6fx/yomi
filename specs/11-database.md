# Spec 11 - Database

Database: Neon Postgres through Drizzle and `@neondatabase/serverless` HTTP mode.

Core tables:

- Better Auth tables: `user`, `session`, `account`, `verification`.
- Billing and usage: `subscriptions`, `payment_records`, `credit_grants`, `credit_transactions`, `usage_events`.
- Devices and gateways: `devices`, `platform_connections`, bot link tokens.
- Connectors: `mcp_connections` with encrypted OAuth tokens.
- RAG: `rag_sources`, `rag_documents`, `rag_chunks`, `rag_embeddings`, `rag_retrieval_logs`.
- Memory: `memory_blobs`, `memory_entries`, `memory_sources`, `memory_relations`, `memory_embeddings`.

Cloudflare Worker rule: use `neon()` HTTP mode only. Do not use pooled WebSocket clients in the Worker.
