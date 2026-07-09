# Yomi DPDP Privacy Compliance Specification

Status: Draft implementation spec  
Owner: Security and Privacy Architecture  
Created: 2026-07-04  
Scope: DPDP Act 2023 readiness, with extensibility for GDPR and CCPA

## 1. Executive Summary

Yomi processes personal data across desktop, sidecar, backend, dashboard,
Telegram, AI memory, RAG, connectors, authentication, and billing. The current
codebase already has good foundations: user-scoped data models, encrypted
connector tokens, Better Auth, plan-gated access, and deletion-by-cascade for
several tables. It does not yet have a first-class privacy control plane.

This spec defines the privacy architecture required to make Yomi
production-ready for the Indian Digital Personal Data Protection Act, 2023. The
implementation must be modular, auditable, user-controlled, and durable enough
to support GDPR, CCPA, and future privacy regimes without redesign.

## 2. Current Repository Audit

This audit is based on the current repository structure and primary
privacy-relevant files:

- `packages/db/src/schema.ts`
- `apps/backend/src/auth-schema.ts`
- `apps/backend/src/auth.ts`
- `apps/backend/src/index.ts`
- `apps/backend/src/routes/*`
- `apps/backend/src/services/*`
- `apps/backend/src/gateway/*`
- `apps/sidecar/src/memory/*`
- `apps/sidecar/src/pipeline/*`
- `apps/desktop/src/main/*`
- `apps/landing/src/app/dashboard/page.tsx`
- `apps/landing/src/components/dashboard/*`

### 2.1 Existing Data Stores

| Store                                 | Purpose                                                                                         | Privacy status                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Postgres via Drizzle                  | Canonical app, auth, billing, memory, RAG, usage, connector data                                | Primary privacy surface                         |
| Better Auth tables                    | User, sessions, OAuth accounts, verification, orgs                                              | Contains profile, sessions, provider tokens     |
| Sidecar environment and local runtime | Session token, local pipeline, cloud memory calls                                               | Needs preference enforcement before cloud calls |
| Desktop app runtime                   | Capture, auth, IPC, sidecar process                                                             | Needs consent and capture status integration    |
| External providers                    | OpenAI-compatible, ElevenLabs, Dodo, Google, GitHub, Notion, Slack, Linear, Telegram | Requires disclosure and data flow tracking      |

### 2.2 Existing Privacy Controls

- `mcp_connections.oauth_tokens` stores encrypted OAuth/API credentials using
  AES-256-GCM in `apps/backend/src/services/token-encryption.ts`.
- `ENCRYPTION_KEY_FALLBACKS` supports token decryption during key rotation.
- `memory.ts` and `rag.ts` strip base64 and image data from memory/RAG content
  before storage.
- Most backend routes require `authenticate` middleware.
- Several tables use `onDelete: "cascade"` to remove child records when parent
  rows are deleted.
- Integration list endpoints intentionally omit token values.
- RAG retrieval logs store query hashes, not raw queries.
- Usage charging is centralized in `services/metering.ts`.

### 2.3 Current Gaps

- No consent ledger, consent versions, revocation model, or policy version
  tracking.
- No unified privacy preferences table.
- No Privacy Center page; dashboard has separate account, integrations, memory,
  schedules, conversation, and status tabs.
- No full data export API or export artifact model.
- No one-click delete-my-data workflow.
- No account deletion workflow that handles all app tables and external
  revocation.
- No transactional deletion orchestrator with step-level reporting.
- No immutable privacy/admin audit log.
- No table-level retention metadata such as `retention_until` or cleanup job
  status.
- No configurable retention policy service.
- Memory can be viewed, edited, and deleted, but memory capture is not governed
  by consent or a global memory-enabled preference.
- RAG source deletion is soft for sources but hard for documents/chunks only in
  some flows; there is no unified retention/delete policy.
- Better Auth `account` tokens appear in plaintext unless Better Auth/plugin
  storage is separately encrypted; this must be verified and remediated.
- Billing logs contain diagnostic Dodo details and should be reviewed for
  over-logging.
- `auth/customSession` logs user ID, trial end date, and subscription status on
  every session load; this is noisy and should be removed or downgraded behind
  debug mode.
- OAuth state for generic connectors must be reviewed for CSRF hardening and
  signed, short-lived state.
- In-memory OAuth initiation rate limiter is per-isolate only; acceptable as
  defense-in-depth, not sufficient for abuse prevention.

## 3. Personal Data Inventory

Classification values:

- Sensitive: credentials, tokens, secrets, financial identifiers, private
  content, biometrics/voice, screenshots.
- Personal: directly identifying or user-owned content.
- Temporary: short-lived operational data.
- Derived: inferred, summarized, indexed, embedded, or analytics data.
- System: service metadata required to operate the product.

| Data item                       | Classification             | Collected by                   | Stored in                                                                    | Existing deletion                            | Encryption status                                                   | Proposed retention                                  |
| ------------------------------- | -------------------------- | ------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| User ID                         | System                     | Better Auth/backend            | `user`, all user-scoped tables                                               | Partial via cascades                         | Not encrypted                                                       | Until account deletion, audit pseudonym retained    |
| Email                           | Personal                   | Better Auth OAuth              | `user.email`, Dodo customer, admin analytics                                 | No user-facing delete                        | Not encrypted                                                       | Until account deletion; billing copy per legal need |
| Name                            | Personal                   | Better Auth/profile            | `user.name`, billing checkout                                                | Profile update only                          | Not encrypted                                                       | Until account deletion                              |
| Profile image                   | Personal                   | Better Auth OAuth              | `user.image`                                                                 | No user-facing delete                        | Not encrypted                                                       | Until account deletion                              |
| Session token                   | Sensitive                  | Better Auth                    | `session.token`                                                              | Sign out/sign out all                        | Better Auth default, likely plaintext hash/token needs verification | Until expiry or sign out                            |
| Session IP and user agent       | Personal/System            | Better Auth                    | `session.ip_address`, `session.user_agent`                                   | Cascade on user delete                       | Not encrypted                                                       | Session lifetime plus 30 days max                   |
| Better Auth OAuth tokens        | Sensitive                  | Better Auth                    | `account.access_token`, `refresh_token`, `id_token`                          | Cascade on user delete                       | Must verify; currently schema is plaintext columns                  | Until disconnect/account deletion                   |
| Connector OAuth/API credentials | Sensitive                  | Integration routes             | `mcp_connections.oauth_tokens`                                               | Disconnect deletes row                       | AES-256-GCM                                                         | Until disconnect/account deletion                   |
| Connector scopes/display names  | Personal/System            | Integration routes             | `mcp_connections.scopes`, `display_name`                                     | Disconnect deletes row                       | Not encrypted                                                       | Until disconnect/account deletion                   |
| Telegram platform user/chat IDs | Personal                   | Gateway link/webhook           | `platform_connections`                                                       | Unlink deletes row                           | Not encrypted                                                       | Until unlink/account deletion                       |
| Device sidecar URL              | Personal/System            | Desktop/backend                | `devices.sidecar_url`                                                        | Cascade on user delete                       | Not encrypted                                                       | 30 days since last seen                             |
| Device OS/app version           | System                     | Desktop/backend                | `devices`                                                                    | Cascade on user delete                       | Not encrypted                                                       | 180 days since last seen                            |
| Shared conversation history     | Personal/Sensitive         | Dashboard/sidecar/backend      | `agent_sessions`, `agent_messages`                                           | Reset closes session only, messages remain   | Not encrypted                                                       | 180 days default                                    |
| Telegram conversations          | Personal/Sensitive         | Telegram gateway/backend agent | `agent_sessions`, `agent_messages`                                           | No user-facing full delete                   | Not encrypted                                                       | 180 days default                                    |
| Agent session summaries         | Derived/Personal           | Backend agent                  | `agent_sessions.summary`                                                     | No user-facing full delete                   | Not encrypted                                                       | 180 days default                                    |
| AI memories                     | Derived/Personal/Sensitive | Sidecar extraction/backend     | `memory_entries`                                                             | View/edit/soft delete/hard delete per memory | Not encrypted                                                       | Until user delete, or `forget_after`                |
| Memory embeddings               | Derived                    | Backend embeddings             | `memory_embeddings`                                                          | Cascade on memory hard delete                | Not encrypted                                                       | Same as memory                                      |
| Memory provenance               | Personal/System            | Backend memory                 | `memory_sources`, `memory_relations`                                         | Cascade on memory delete                     | Not encrypted                                                       | Same as memory                                      |
| RAG sources                     | Personal/System            | Dashboard/sidecar              | `rag_sources`                                                                | Soft delete source                           | Not encrypted                                                       | 180 days default unless user pins                   |
| RAG document metadata           | Personal                   | Backend RAG                    | `rag_documents.metadata`                                                     | Cascade when source documents deleted        | Not encrypted                                                       | Same as source                                      |
| RAG chunks                      | Sensitive/Personal         | Backend RAG                    | `rag_chunks.content`                                                         | Cascade when document deleted                | Not encrypted                                                       | Same as source                                      |
| RAG embeddings                  | Derived                    | Backend embeddings             | `rag_embeddings.embedding`                                                   | Cascade when chunk deleted                   | Not encrypted                                                       | Same as chunk                                       |
| RAG retrieval logs              | Derived/System             | Backend RAG                    | `rag_retrieval_logs.query_hash`, `matched_chunk_ids`                         | No user-facing delete                        | Not encrypted                                                       | 30 days                                             |
| Voice audio                     | Sensitive/Temporary        | Desktop/sidecar/STT            | Runtime/transit to ElevenLabs/backend STT                                    | Not stored in DB found                       | N/A                                                                 | No storage by default                               |
| Voice transcripts               | Personal/Sensitive         | STT/sidecar                    | May be in conversations, memory, usage metadata                              | No unified delete                            | Not encrypted                                                       | 30 days if stored                                   |
| Screenshots                     | Sensitive/Temporary        | Desktop capture/sidecar/LLM    | Runtime/transit; possible prompts/conversation/memory                        | No unified delete                            | N/A unless persisted                                                | 24 hours max if persisted                           |
| Uploaded files/documents        | Sensitive/Personal         | RAG APIs                       | Stored as chunks, metadata, embeddings; original file storage not identified | Source soft delete                           | Not encrypted                                                       | 7 days raw temp, 180 days indexed default           |
| Schedules/prompts               | Personal/Sensitive         | Dashboard/backend              | `schedules.prompt`, `deliver_to`, errors                                     | Delete/update routes exist                   | Not encrypted                                                       | Until disabled/deleted, max 180 days after disabled |
| Pending actions                 | Sensitive/Personal         | Agent tools/backend            | `pending_actions.payload`, preview, result                                   | Expires but no cleanup confirmed             | Not encrypted                                                       | Until expiry plus 7 days                            |
| Usage events                    | Derived/System             | Backend metering               | `usage_events`                                                               | Admin can wipe current month only            | Not encrypted                                                       | 90 days detailed; aggregate after                   |
| Credit ledger                   | System/Billing             | Backend billing/metering       | `credit_accounts`, `credit_grants`, `credit_transactions`                    | No delete except account cascade             | Not encrypted                                                       | Financial audit period                              |
| Payment records                 | Personal/Billing           | Dodo webhook/backend           | `payment_records`, `processed_payment_events`                                | No user-facing delete                        | Provider IDs not encrypted                                          | Legal/accounting period                             |
| Trial/subscription status       | Personal/System            | Auth/billing                   | `user` columns                                                               | Account deletion only                        | Not encrypted                                                       | Account lifetime; billing legal exception           |
| Waitlist/contact data           | Personal                   | Landing pages                  | Need implementation audit of API routes                                      | Unknown                                      | Unknown                                                             | Until request deletion or 180 days                  |
| Logs                            | Personal/System risk       | Backend console/Workers        | Runtime provider logs                                                        | No user-facing delete                        | Provider-managed                                                    | 90 days max, redacted                               |

## 4. Data Flow Analysis

### 4.1 Account And Auth

Flow:

1. User signs in on landing/dashboard with Google or GitHub through Better Auth.
2. Better Auth writes `user`, `session`, and `account` records.
3. Backend `authenticate` loads the session for API access.
4. Desktop uses device-code auth through `/api/auth/device-code/*` and stores a
   session token for sidecar calls.
5. Dashboard proxies backend calls with the Bearer session token.

Controls required:

- Consent capture immediately after first authenticated session, before optional
  data processing.
- Encrypt or avoid storing provider account tokens in Better Auth `account`
  table.
- Privacy preference checks in all optional processing routes.
- Session revocation on account deletion.

### 4.2 Desktop Voice And Screen Understanding

Flow:

1. Desktop captures microphone and optional screen context.
2. Sidecar transcribes via local or ElevenLabs-backed STT.
3. Sidecar sends distilled prompt/context to LLM provider through configured
   model path.
4. Result may be spoken through TTS and may be saved to conversation or memory.

Controls required:

- Voice consent before microphone processing.
- Screenshot/screen-understanding consent before capture or upload.
- Explicit UI indicator while listening/capturing.
- Do not store raw audio or screenshots by default.
- Prevent memory capture unless memory consent and preference are enabled.

### 4.3 AI Chat And Conversation History

Flow:

1. User asks Yomi through desktop, dashboard, or Telegram.
2. Agent/fast pipeline sends request to AI provider.
3. Backend may append turns to `agent_messages` through
   `/api/conversation/shared/turn` or backend agent sessions.
4. Dashboard reads `/api/conversation/shared`.

Controls required:

- Conversation-history consent gates writes to `agent_messages`.
- Retention applies to old sessions/messages.
- Export includes sessions and messages.
- Delete my data hard-deletes sessions/messages.

### 4.4 Cloud Memory

Flow:

1. Sidecar extracts durable memories from user/assistant turns in
   `captureCloudMemory`.
2. Extracted JSON is sent to `/api/memory/sync`.
3. Backend writes `memory_entries`, provenance, relations, and embeddings.
4. Future queries call `/api/memory/search` and `/api/memory/profile`.

Controls required:

- Cloud memory consent and memory-enabled preference before extraction or
  retrieval.
- Memory Manager remains the canonical view/edit/delete surface.
- Export includes memory entries and provenance but not raw embedding vectors
  unless explicitly requested for machine portability.
- Delete all memories hard-deletes entries, embeddings, relations, and sources.

### 4.5 Cloud RAG And Uploaded Documents

Flow:

1. User or sidecar syncs documents/sources to `/api/rag/sync` or
   `/api/rag/documents`.
2. Backend chunks content into `rag_chunks` and creates `rag_embeddings`.
3. Queries call `/api/rag/search`; retrieval logs store query hash and matched
   chunk IDs.

Controls required:

- Cloud memory/RAG consent before document sync.
- Source delete should hard-delete documents/chunks/embeddings or mark source
  deleted and queue hard cleanup.
- Retention metadata on sources/documents/chunks.
- Export includes source metadata, document metadata, and chunk content in JSON.

### 4.6 Connectors

Flow:

1. User starts OAuth/API-key/DSN connection in dashboard.
2. Backend stores encrypted credential blob in `mcp_connections`.
3. Sidecar/internal token broker retrieves access tokens through
   `/api/integrations/token/:provider`.
4. Connector tools call external provider APIs.
5. Disconnect deletes `mcp_connections`, with Google token revoke as best
   effort.

Controls required:

- Connector consent before connect.
- Per-provider disconnect handler with token revocation and cache cleanup.
- No connector sync after disconnect.
- Audit log every connect/disconnect/reconnect and revocation result.

### 4.7 Telegram

Flow:

1. User links Telegram with a token/code.
2. Gateway stores `platform_connections`.
3. Telegram webhook receives updates and processes messages in background.
4. Agent messages and usage events are written.

Controls required:

- Telegram consent before bot processing after link.
- Unlink deletes `platform_connections` and stops future routing.
- Delete my data removes Telegram sessions/messages and pending actions.

### 4.8 Billing And Credits

Flow:

1. User creates Dodo checkout from dashboard.
2. Dodo webhooks update `payment_records`, `user` subscription fields, credit
   grants, transactions.
3. Usage metering consumes credits and records `usage_events`.

Controls required:

- Billing export includes payment history and credit ledger.
- Account deletion must preserve only records legally required for accounting,
  pseudonymized where possible.
- Avoid logging Dodo payloads or checkout objects containing personal fields.

## 5. Privacy Architecture

### 5.1 Design Principles

- Privacy is enforced server-side, not only in UI.
- Consent and preferences are separate: consent is the auditable legal basis;
  preferences are current product behavior toggles.
- Deletion and export are orchestrated by a central service, not scattered
  across route handlers.
- Every personal-data table has an owner, retention policy, export handler, and
  delete handler.
- External provider revocation is best effort but recorded.
- Immutable audit logs record privacy actions without storing private content.
- Default behavior minimizes storage.

### 5.2 New Backend Modules

Add these modules under `apps/backend/src/services/privacy/`:

- `registry.ts`: central registry of data domains and handlers.
- `consent.ts`: consent grant/revoke/read operations.
- `preferences.ts`: privacy preference read/update with defaults.
- `export.ts`: builds user export manifest and JSON archive.
- `deletion.ts`: orchestrates delete-my-data and delete-account workflows.
- `retention.ts`: evaluates policies and runs cleanup.
- `audit.ts`: append-only privacy audit events.
- `connectors.ts`: provider-specific disconnect/revoke/cache cleanup.

The privacy registry is the key abstraction:

```ts
type PrivacyDataDomain = {
  key: string
  label: string
  tables: string[]
  classification: "sensitive" | "personal" | "temporary" | "derived" | "system"
  export: (ctx: PrivacyJobContext) => Promise<PrivacyExportSection>
  delete: (ctx: PrivacyJobContext) => Promise<PrivacyDeleteResult>
  applyRetention?: (ctx: RetentionContext) => Promise<RetentionResult>
}
```

All future data stores must register here before launch.

## 6. Database Changes

Create a migration after `0022_dodo_cleanup_memory.sql`.

### 6.1 User Privacy Fields

Add to `user`:

- `deleted_at timestamp null`
- `privacy_preferences jsonb not null default '{}'`
- `consent_version text null`
- `consent_timestamp timestamp null`
- `privacy_policy_version text null`
- `terms_version text null`
- `last_export_at timestamp null`
- `export_count integer not null default 0`

These are convenience fields only. The source of truth for consent history is
`privacy_consents`.

### 6.2 `privacy_consents`

Stores consent history and revocations.

Columns:

- `id uuid primary key default_random_uuid()`
- `user_id text not null references user(id) on delete cascade`
- `purpose text not null`
- `status text not null` (`granted`, `revoked`)
- `consent_version text not null`
- `privacy_policy_version text not null`
- `terms_version text not null`
- `app_version text null`
- `ip_address text null`
- `user_agent text null`
- `metadata jsonb null`
- `created_at timestamp not null default now()`

Indexes:

- `(user_id, purpose, created_at desc)`
- `(user_id, status)`

### 6.3 `privacy_preferences`

Stores current user settings independently from consent history.

Columns:

- `user_id text primary key references user(id) on delete cascade`
- `conversation_history_enabled boolean not null default false`
- `memory_enabled boolean not null default false`
- `cloud_memory_enabled boolean not null default false`
- `connectors_enabled boolean not null default false`
- `analytics_enabled boolean not null default false`
- `voice_processing_enabled boolean not null default false`
- `screen_processing_enabled boolean not null default false`
- `ai_improvement_enabled boolean not null default false`
- `retention_overrides jsonb null`
- `updated_at timestamp not null default now()`

Default false for optional processing. Auth, billing, and security-essential
processing remain required for service delivery.

### 6.4 `privacy_exports`

Tracks export jobs.

Columns:

- `id uuid primary key default_random_uuid()`
- `user_id text not null references user(id) on delete cascade`
- `status text not null` (`queued`, `running`, `ready`, `failed`, `expired`)
- `format text not null default 'json'`
- `manifest jsonb null`
- `archive_url text null`
- `archive_sha256 text null`
- `error text null`
- `requested_at timestamp not null default now()`
- `completed_at timestamp null`
- `expires_at timestamp null`

Initial implementation may return JSON synchronously for small exports and still
insert an audit row. Add object storage later if exports become large.

### 6.5 `privacy_deletion_jobs`

Tracks delete-my-data and delete-account workflows.

Columns:

- `id uuid primary key default_random_uuid()`
- `user_id text not null`
- `kind text not null` (`delete_data`, `delete_account`)
- `status text not null` (`queued`, `running`, `completed`, `failed`)
- `steps jsonb not null default '[]'`
- `error text null`
- `requested_at timestamp not null default now()`
- `completed_at timestamp null`

Do not cascade this table on user delete; keep only pseudonymous `user_id` and
step metadata. No content.

### 6.6 `privacy_audit_events`

Append-only audit log.

Columns:

- `id uuid primary key default_random_uuid()`
- `actor_user_id text null`
- `target_user_id text null`
- `event_type text not null`
- `resource_type text null`
- `resource_id text null`
- `ip_address text null`
- `user_agent text null`
- `metadata jsonb null`
- `created_at timestamp not null default now()`

Rules:

- No update route.
- No delete route.
- Metadata must be redacted and must not contain prompts, tokens, emails,
  attachments, screenshots, message content, or OAuth credentials.

### 6.7 Retention Columns

Add where practical:

- `retention_until timestamp null`
- `deleted_at timestamp null`

Priority tables:

- `agent_sessions`
- `agent_messages`
- `rag_sources`
- `rag_documents`
- `rag_chunks`
- `rag_retrieval_logs`
- `memory_entries`
- `pending_actions`
- `usage_events`
- `devices`
- `linking_codes`
- `telegram_link_tokens`
- `device_codes`

For high-churn child tables, it is acceptable to rely on parent
`retention_until` plus cascade deletion if adding columns everywhere is too
costly.

## 7. Consent System

### 7.1 Consent Purposes

Define constants in `packages/shared/src/privacy.ts`:

- `conversation_history`
- `memory`
- `cloud_memory`
- `connector_data`
- `analytics`
- `voice_processing`
- `screen_processing`
- `ai_improvement`
- `telegram_processing`
- `rag_processing`

### 7.2 Consent Rules

- Consent must be explicit, versioned, timestamped, and revocable.
- Revocation stops future processing immediately.
- Revocation does not automatically delete historical data unless the user
  chooses delete-my-data or delete-account.
- Consent checks must happen in backend services and sidecar preflight checks.
- UI must show missing required consents before enabling features.

### 7.3 Consent APIs

Routes under `/api/privacy`:

- `GET /consents`: current consent status and history.
- `POST /consents`: grant one or more purposes.
- `POST /consents/revoke`: revoke one or more purposes.
- `GET /preferences`: current privacy preferences.
- `PATCH /preferences`: update preferences and optional retention overrides.
- `GET /overview`: Privacy Center summary.

All routes require `authenticate`.

## 8. Privacy Center

Add a new dashboard tab or route:

- Preferred route: `apps/landing/src/app/dashboard/privacy/page.tsx`.
- Also add a dashboard tab entry named `Privacy` for discoverability.

Sections:

- Privacy Overview
- Consent Status
- Data Stored
- Connected Apps
- Memories
- Storage Usage
- Download My Data
- Delete My Data
- Delete Account
- Manage Memories
- Manage Connectors
- Consent History
- Privacy Policy
- Terms
- Data Retention
- Security
- Recent Privacy Activity

The UI should reuse existing dashboard visual language and `MemoryManager`,
connector marketplace, and conversation manager where possible. Do not duplicate
memory or connector logic.

## 9. Delete My Data

### 9.1 Semantics

Delete-my-data removes optional product data while keeping the account, active
subscription, credit balance, and legally required billing records.

Delete:

- `agent_messages`
- `agent_sessions`
- `memory_entries`
- `memory_sources`
- `memory_relations`
- `memory_embeddings`
- `rag_sources`
- `rag_documents`
- `rag_chunks`
- `rag_embeddings`
- `rag_retrieval_logs`
- `mcp_connections`
- connector cached metadata/files
- `platform_connections`
- `pending_actions`
- `schedules`
- optional `usage_events` older than required metering window or all non-billing
  usage if allowed
- expired `linking_codes`, `telegram_link_tokens`, `device_codes`
- local sidecar/desktop caches through a desktop command where possible

Preserve:

- `user` account row
- Better Auth current session unless user chooses sign out all
- active subscription state
- credit account and credit ledger
- payment records and processed payment events needed for accounting/fraud/legal
  obligations
- privacy audit events

### 9.2 Transaction Model

Use a database transaction for database deletes. External revocations cannot be
part of the transaction, so the workflow is:

1. Create `privacy_deletion_jobs` row with status `running`.
2. Read connector credentials needed for revocation.
3. Attempt provider revocations and record results.
4. Start DB transaction.
5. Delete app data by domain through the privacy registry.
6. Reset privacy preferences to safe defaults.
7. Insert audit events.
8. Mark job `completed`.

If any database step fails, roll back. If external revocation fails, continue
database deletion and report the provider revocation as failed/best-effort in
job steps.

## 10. Delete Account

### 10.1 Semantics

Delete-account closes the account and removes all personal data except records
that must be retained for legal, accounting, fraud-prevention, or security
reasons.

Required steps:

1. Revoke connector tokens.
2. Disconnect platforms.
3. Delete optional data via delete-my-data registry.
4. Cancel active Dodo subscription or mark cancellation requested.
5. Revoke Better Auth sessions.
6. Delete Better Auth `account`, `session`, and `verification` records.
7. Delete or anonymize `user` row.
8. Pseudonymize billing records where legally allowed.
9. Keep privacy audit event with pseudonymous target ID.

Recommended approach:

- Soft-delete `user.deleted_at` immediately to block access.
- Complete destructive cleanup in the same request if feasible.
- If account row must remain for billing reconciliation, replace
  email/name/image with `deleted+<hash>@deleted.yomi.local`, `Deleted User`, and
  null image.

## 11. Export My Data

### 11.1 Export Format

Initial implementation: JSON response or JSON file. Future implementation: ZIP
archive with JSON files by domain.

Export manifest:

```json
{
  "schemaVersion": "2026-07-04",
  "generatedAt": "ISO-8601",
  "userId": "...",
  "sections": [
    { "key": "profile", "count": 1 },
    { "key": "conversations", "count": 12 },
    { "key": "memories", "count": 40 }
  ]
}
```

Sections:

- `profile.json`
- `consents.json`
- `preferences.json`
- `conversations.json`
- `memories.json`
- `rag.json`
- `schedules.json`
- `connectors.json` without tokens
- `platform_connections.json`
- `usage.json`
- `billing.json`
- `devices.json`
- `audit_activity.json` privacy events only

Never export OAuth tokens, refresh tokens, session tokens, API keys, encrypted
token blobs, raw password hashes, or webhook secrets.

### 11.2 Export APIs

- `POST /api/privacy/export`: start export.
- `GET /api/privacy/export/:id`: get status.
- `GET /api/privacy/export/:id/download`: download ready export.

For phase 1, `POST /api/privacy/export` may synchronously return JSON if payload
size is small. Still record an audit event.

## 12. Connector Privacy

Add a connector cleanup interface in backend connector definitions:

```ts
type ConnectorPrivacyHandler = {
  provider: string
  revoke?: (tokens: OAuthTokens) => Promise<ConnectorRevokeResult>
  deleteCache?: (userId: string) => Promise<ConnectorCleanupResult>
}
```

Provider requirements:

- Google: revoke access or refresh token; delete `mcp_connections`; delete
  cached Gmail, Calendar, Drive, Classroom data if introduced.
- GitHub: revoke OAuth token if app credentials allow; delete cached repo
  metadata.
- Notion, Slack, Linear: revoke where supported; delete cached metadata.
- API-key/DSN connectors: delete encrypted credential row immediately; never
  show secret in export.

Disconnect API remains `DELETE /api/integrations/:provider`, but it should
delegate to the privacy connector cleanup service and write audit events.

## 13. Retention Policy

### 13.1 Defaults

| Domain                   | Default retention                                      |
| ------------------------ | ------------------------------------------------------ |
| Conversations            | 180 days                                               |
| Agent sessions summaries | 180 days                                               |
| Voice transcripts        | 30 days                                                |
| Screenshots              | 24 hours if persisted; do not persist by default       |
| Raw uploaded temp files  | 7 days                                                 |
| RAG indexed documents    | 180 days unless user pins source                       |
| RAG retrieval logs       | 30 days                                                |
| Usage events             | 90 days detailed, aggregate after                      |
| Pending actions          | Expiry plus 7 days                                     |
| Logs                     | 90 days max                                            |
| Device records           | 180 days since last seen                               |
| OAuth tokens             | Until disconnect/account deletion                      |
| Memory                   | Until user deletes, disables memory, or `forget_after` |
| Billing records          | Legal/accounting period                                |
| Privacy audit events     | Minimum 3 years, no private content                    |

### 13.2 Cleanup Job

Add a backend scheduled job:

- Local/dev: callable route `POST /api/privacy/admin/run-retention`, owner-only.
- Production Worker: cron handler in `worker.ts` invokes
  `applyRetentionPolicies()`.

Retention job must:

- Process in bounded batches.
- Avoid long transactions across unrelated domains.
- Record audit summary with counts only.
- Never log deleted content.

## 14. Memory Management

Existing memory APIs already provide list, add, search, edit, forget, sync, and
delete. Enhance rather than replace.

Required changes:

- Gate `captureCloudMemory` in sidecar on privacy preferences and consent.
- Gate backend `/api/memory/add`, `/sync`, `/search`, and `/profile` on
  memory/cloud memory consent where appropriate.
- Add `DELETE /api/memory` or `/api/privacy/memories` to delete all memories.
- Add `GET /api/privacy/memories/export` or include in full export.
- Add memory disabled state to Privacy Center.
- When memory is disabled, stop capture and retrieval. Existing memory remains
  until user deletes it.

## 15. Encryption Review

### 15.1 Current State

- Connector credentials in `mcp_connections.oauth_tokens` are AES-256-GCM
  encrypted.
- Key comes from `ENCRYPTION_KEY`, with fallbacks from
  `ENCRYPTION_KEY_FALLBACKS`.
- Key rotation is read-compatible but does not automatically re-encrypt all
  stored rows.
- Better Auth `account` token fields need verification; schema exposes plaintext
  columns.

### 15.2 Required Work

- Add `key_version` or ciphertext envelope prefix for connector credentials.
- Add a key rotation job that decrypts with fallback and re-encrypts with
  primary.
- Encrypt Better Auth provider tokens or configure Better Auth to avoid storing
  tokens unless needed.
- Encrypt or pseudonymize sensitive billing identifiers where operationally
  possible.
- Keep secrets only in environment/bindings; never in code or client bundles.
- Add tests for encryption, fallback decryption, and rotation.

## 16. Logging Policy

Never log:

- Full conversations
- Full prompts
- OAuth tokens
- API keys
- Refresh tokens
- Emails unless strictly owner/admin diagnostic and gated
- Attachments
- Screenshots
- Voice transcripts
- Dodo webhook payloads containing customer data

Allowed logs:

- User ID or hashed user ID
- Endpoint
- Status code
- Latency
- Model
- Token counts
- Credits charged
- Connector count/provider ID
- Redacted error code/message

Immediate cleanup targets:

- Remove or debug-gate `console.warn` in `auth/customSession`.
- Review Dodo checkout and fetch logs for personal data leakage.
- Review Telegram webhook logs; update ID is acceptable, message text is not.

## 17. Data Minimization

Required changes:

- Store summaries instead of full turns when conversation history is disabled.
- Avoid storing raw uploaded documents beyond indexing unless explicitly
  required.
- Hash RAG queries as currently done; keep it.
- Avoid storing `sidecar_url` longer than needed.
- Limit `pending_actions.payload` to minimum executable payload and redact
  previews where possible.
- Make usage metadata schema explicit and reject prompt/content fields.
- Store connector display names as account labels only; do not cache provider
  profile details unnecessarily.

## 18. Admin Audit Log

Use `privacy_audit_events` for:

- Consent granted/revoked
- Preferences changed
- Export requested/completed/downloaded
- Delete-my-data requested/completed/failed
- Delete-account requested/completed/failed
- Connector connected/disconnected/revocation failed
- Memory created/edited/deleted/delete-all
- Retention job completed
- Admin viewed analytics
- Admin adjusted credits

Metadata examples:

```json
{
  "purposes": ["memory", "cloud_memory"],
  "policyVersion": "2026-07-04",
  "source": "dashboard"
}
```

Do not include content, email, token, prompt, or attachment data.

## 19. Security Review Recommendations

Authentication:

- Keep all privacy APIs behind `authenticate`.
- Add re-authentication or typed confirmation for delete account.
- Revoke all sessions on account deletion.

Authorization:

- Every query must filter by authenticated `user.id`.
- Admin routes must use owner checks and audit every access.

Rate limiting:

- Move OAuth initiation rate limiting to a durable store if abuse becomes a
  concern.
- Rate-limit export and deletion endpoints.

CSRF:

- Use Better Auth protections for browser session routes.
- Require Bearer token or same-site session with CSRF protection for destructive
  routes.
- Sign and expire OAuth states.

XSS:

- Treat memory, conversation, schedule prompts, and connector metadata as
  untrusted.
- Render as text only; do not use raw HTML.

SQL injection:

- Continue using Drizzle parameterization.
- Review raw SQL in memory/RAG search for parameterized interpolation only.

Headers/cookies:

- Keep auth cookies secure, HTTP-only, SameSite appropriate for split-domain
  setup.
- Add security headers at landing/backend edge if absent.

Least privilege:

- Reduce Google default scopes where feature-specific scopes are possible.
- Do not request Gmail modify/send unless user enables actions requiring them.

## 20. API Surface

Add `apps/backend/src/routes/privacy.ts` mounted at `/api/privacy`.

Endpoints:

- `GET /api/privacy/overview`
- `GET /api/privacy/consents`
- `POST /api/privacy/consents`
- `POST /api/privacy/consents/revoke`
- `GET /api/privacy/preferences`
- `PATCH /api/privacy/preferences`
- `POST /api/privacy/export`
- `GET /api/privacy/export/:id`
- `GET /api/privacy/export/:id/download`
- `POST /api/privacy/delete-data`
- `GET /api/privacy/delete-data/:id`
- `POST /api/privacy/delete-account`
- `GET /api/privacy/activity`
- `GET /api/privacy/retention`
- `PATCH /api/privacy/retention`
- `DELETE /api/privacy/memories`
- `GET /api/privacy/memories/export`
- `POST /api/privacy/admin/run-retention` owner-only

## 21. Testing Plan

Backend tests:

- Consent grant/revoke history is append-only.
- Current consent state returns latest event per purpose.
- Preferences default to safe values.
- Memory sync is blocked without memory consent.
- Conversation write is blocked without conversation consent.
- Export includes expected sections and excludes tokens/secrets.
- Delete-my-data removes all optional data and preserves billing/credits.
- Delete-account anonymizes or removes user data and revokes sessions.
- Connector disconnect deletes credential row and records audit event.
- Retention deletes expired data only.
- Audit log rejects content-like metadata keys.
- Encryption fallback decrypts old tokens and rotation rewrites to primary.

Frontend tests:

- Privacy Center loads overview.
- Consent toggles call correct APIs.
- Export and deletion flows require confirmation.
- Delete buttons show status and errors.
- Memory and connector management links reuse existing components.

Integration tests:

- Create test user, add memory, RAG source, conversation, schedule, connector,
  usage, then run export and delete-my-data.
- Verify all registered privacy domains report zero remaining optional records
  after deletion.

## 22. Documentation Deliverables

Create docs under `specs/privacy/` or a future `docs/privacy/` directory:

- Architecture
- Data inventory
- Data flow diagrams
- Consent flow
- Export flow
- Deletion flow
- Retention flow
- Connector privacy guide
- Encryption and key rotation guide
- Logging policy
- Threat model
- Security checklist
- Developer guide for registering new data domains

## 23. Implementation Phases

### Phase A: Foundation

- Add shared privacy constants.
- Add DB migration for consent, preferences, exports, deletion jobs, audit
  events.
- Add privacy services and registry skeleton.
- Add `/api/privacy/overview`, consent, preferences, and activity endpoints.
- Add audit helper and tests.

### Phase B: Consent Enforcement

- Gate sidecar memory capture/retrieval.
- Gate backend memory, RAG, conversation, voice, screen, connector, and
  analytics writes.
- Add first-run consent UI in dashboard/desktop path.
- Add policy/terms/privacy version constants.

### Phase C: Privacy Center UI

- Add Privacy Center route/tab.
- Show overview, data stored, connected apps, consent status, memory status,
  retention, and recent privacy activity.
- Reuse existing MemoryManager and connector UI.

### Phase D: Export

- Implement registry export handlers.
- Add export APIs.
- Generate JSON manifest.
- Add frontend download flow.
- Add tests to ensure secrets are excluded.

### Phase E: Delete My Data And Connector Cleanup

- Implement registry delete handlers.
- Implement deletion transaction orchestration.
- Implement connector revocation handlers.
- Add frontend delete-data flow with typed confirmation.
- Add comprehensive integration tests.

### Phase F: Delete Account

- Add account deletion workflow.
- Add Dodo cancellation/anonymization handling.
- Revoke sessions and provider tokens.
- Add re-auth/confirmation UI.

### Phase G: Retention

- Add retention columns where needed.
- Implement retention service and cron/admin route.
- Add preference overrides.
- Add tests for each retention domain.

### Phase H: Encryption And Logging Hardening

- Encrypt or eliminate Better Auth provider token storage.
- Add key versioning/rotation job.
- Remove noisy logs and enforce redacted logging helpers.
- Add lint/test checks for known secret/content logging patterns where
  practical.

## 24. Acceptance Criteria

- Privacy Center is available from dashboard.
- User can grant, view, and revoke consent with history.
- User can download data export with no secrets included.
- User can delete product data without deleting billing/credit state.
- User can delete account with sessions revoked and optional data removed.
- User can manage, export, disable, and delete memories.
- Connectors support disconnect, token deletion, and cache cleanup.
- Retention job enforces defaults.
- Privacy audit events are append-only and content-free.
- Sensitive tokens are encrypted and rotation is supported.
- Logs do not contain conversations, prompts, OAuth tokens, emails, screenshots,
  or attachments.
- Tests cover consent, export, deletion, retention, connector cleanup, memory
  deletion, preferences, and audit logs.

## 25. Non-Goals For First Implementation

- Full legal policy drafting. Product/legal counsel must review public Privacy
  Policy and Terms.
- Cross-region data residency controls.
- Enterprise DPA workflow.
- Object storage ZIP export unless JSON size requires it.
- Admin UI for all audit logs beyond recent privacy activity.

## 26. Open Questions

- Should cloud memory and RAG be opt-in for all users after this migration, or
  should existing users receive an interstitial and have processing paused until
  they respond?
- Which billing records must be retained for legal/accounting periods in Yomi's
  operating jurisdictions?
- Does Better Auth support field-level encryption for `account` tokens in the
  current version, or should Yomi override account storage?
- Will raw uploaded files ever be persisted outside RAG chunks? If yes, object
  storage must be added to the privacy registry.
- Should export archives be generated synchronously initially, or should all
  exports use an async job model from day one?
