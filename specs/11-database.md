# Spec 11 - Database

Database: Neon Postgres through Drizzle and `@neondatabase/serverless` HTTP
mode.

Core tables:

- Better Auth tables: `user`, `session`, `account`, `verification`. User
  extended with `plan`, `subscription_status`, `trial_start_date`,
  `trial_end_date`, `current_period_end`, `dodo_subscription_id`.
- Billing and usage (pure-credit model): `usage_events` (append-only),
  `credit_accounts` (balance + lifetime totals), `credit_grants` (per-batch with
  expiry), `credit_transactions` (audit log), `payment_records`,
  `processed_payment_events`, `subscriptions`.
- Agent: `agent_runs`, `agent_sessions`, `agent_messages`, `pending_actions`.
- Devices and gateways: `devices`, `platform_connections`, `linking_codes`,
  `telegram_link_tokens`, `device_codes`.
- Connectors: `mcp_connections` with encrypted OAuth tokens.
- RAG: `rag_sources`, `rag_documents`, `rag_chunks`, `rag_embeddings`,
  `rag_retrieval_logs`.
- Memory: `memory_blobs`, `memory_entries`, `memory_sources`,
  `memory_relations`, `memory_embeddings`.
- Observability: `hook_logs` (PII redacted).

Cloudflare Worker rule: use `neon()` HTTP mode only. Do not use pooled WebSocket
clients in the Worker.
