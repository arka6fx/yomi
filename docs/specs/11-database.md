# Spec 11 - Database

Relational data lives in **Cloudflare D1** (`yomi-prod`; `yomi-staging` for
staging). The backend container has no D1 binding. It sends SQL to the
`yomi-storage` gateway Worker (`apps/api/containers/storage.ts`), which runs it
against D1. Multi-statement writes use D1 batches (`store.atomic([...])`), which
run as a single transaction.

Embeddings live in **Vectorize** (`yomi-vectors-768`, 768 dimensions, namespaced
per user). Media and ingest blobs live in **R2**.

The schema is the numbered SQL files in `apps/api/migrations-d1/`, which are the
source of truth. Migrations are applied by hand; see the
[runbook](../runbook.md#database-migrations-d1).

Core tables:

- **Auth:** `user`, `session`, `account`, `verification`,
  `telegram_login_requests`. `user` also carries `plan`, `subscription_status`,
  and the trial dates.
- **Billing and usage:** `usage_events` (append-only), `credit_accounts`,
  `credit_grants`, `credit_transactions`, `payment_records`,
  `processed_payment_events`, `ai_usage_events`.
- **Agent:** `agent_sessions`, `agent_messages`, `agent_runs`,
  `agent_run_steps`, `pending_actions`.
- **Gateways and linking:** `platform_connections`, `telegram_link_tokens`,
  `linking_codes`, `device_codes`, `devices`.
- **Connectors:** `mcp_connections`, `composio_connections`,
  `custom_mcp_servers` (OAuth tokens encrypted).
- **Memory:** `memory_entries`, `memory_sources`, `memory_relations`.
- **RAG:** `rag_sources`, `rag_documents`, `rag_chunks`, `rag_retrieval_logs`.
- **Routines and suggestions:** `schedules`, `generated_suggestions`,
  `suggestion_decisions`.
- **Vault:** `vault_items`, `vault_payments` (secrets encrypted).
- **Trusted people:** `trust_links`, `trust_messages`, `trust_settings`.
- **Email:** `email_aliases`, `inbound_emails`, `expenses`.
- **Characters:** `characters`, `active_characters`, `character_settings`,
  `character_saves`, `character_chats`, `character_likes`.
- **Privacy:** `privacy_consents`, `privacy_preferences`,
  `privacy_audit_events`, `privacy_exports`, `privacy_deletion_jobs`.
- **Growth:** `referral_events`, `lifecycle_messages` (onboarding and win-back
  nudges sent, skipped, or opted out of; one row per user per step).

The web app never connects to storage directly. All access goes through the
backend API.

## Legacy Postgres

`STORAGE_BACKEND=postgres` switches the backend to the earlier Postgres path:
SQLAlchemy models in `packages/db` and Alembic migrations in
`apps/api/migrations`. Production does not use it. It remains only as a
fallback, and `apps/api/scripts/migrate_neon_to_d1.py` records the one-time
cutover.
