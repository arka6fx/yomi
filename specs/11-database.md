# Spec 11 - Database

Database: PostgreSQL (Neon) through Drizzle and `@neondatabase/serverless`
(`drizzle-orm/neon-http`). The HTTP connection is stateless per query, so there
are no interactive transactions — multi-write atomicity uses `db.batch([...])`.

Core tables:

- Better Auth tables: `user`, `session`, `account`, `verification`. User
  extended with `plan`, `subscription_status`, `trial_start_date`,
  `trial_end_date`, `current_period_end`, `dodo_subscription_id`.
- Billing and usage (pure-credit model): `usage_events` (append-only),
  `credit_accounts` (balance + lifetime totals), `credit_grants` (per-batch with
  expiry), `credit_transactions` (audit log), `payment_records`,
  `processed_payment_events`.
- Agent: `agent_sessions`, `agent_messages`, `pending_actions`.
- Devices and gateways: `devices`, `platform_connections`, `linking_codes`,
  `telegram_link_tokens`, `device_codes`.
- Connectors: `mcp_connections` with encrypted OAuth tokens.
- RAG: `rag_sources`, `rag_documents`, `rag_chunks`, `rag_embeddings`,
  `rag_retrieval_logs`.
- Memory: `memory_entries`, `memory_sources`, `memory_relations`,
  `memory_embeddings`.
- Observability: `ai_usage_events` (rich per-request AI telemetry, additive to
  `usage_events`).

The landing Worker does not connect to Postgres directly; all DB access goes
through the backend API.
