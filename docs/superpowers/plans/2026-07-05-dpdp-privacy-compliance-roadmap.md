# Yomi DPDP Privacy Compliance — Roadmap

> **For agentic workers:** This is a ROADMAP, not a bite-sized execution plan.
> Each phase below must be expanded into its own detailed plan file (via
> superpowers:writing-plans, one file per phase) before execution. Use
> superpowers:subagent-driven-development or superpowers:executing-plans only
> once a phase has its own bite-sized plan.

**Source spec:** `specs/23-dpdp-privacy-compliance.md`

**Goal:** Make Yomi production-ready for the Indian DPDP Act 2023 (extensible
to GDPR/CCPA) by adding a first-class privacy control plane: consent ledger,
privacy preferences, Privacy Center UI, full data export, delete-my-data and
delete-account workflows, retention enforcement, connector revocation, and
encryption/logging hardening.

**Architecture:** A central privacy registry (`PrivacyDataDomain` handlers per
data domain) drives export, deletion, and retention so per-table logic lives
in one place instead of scattered route handlers. Consent (auditable legal
basis, append-only history in `privacy_consents`) is kept separate from
preferences (current toggles in `privacy_preferences`). All privacy actions
write append-only, content-free `privacy_audit_events`. Enforcement is
server-side in backend services plus sidecar preflight checks — never UI-only.

**Tech Stack:** Hono/Bun backend (Cloudflare Workers), Drizzle + Neon,
Better Auth, Bun sidecar, Next.js landing dashboard.

## Global Constraints

- Privacy is enforced server-side, not only in UI.
- Consent must be explicit, versioned, timestamped, and revocable; revocation
  stops future processing immediately but does not auto-delete history.
- Optional-processing preferences default to `false`; auth, billing, and
  security-essential processing remain required for service delivery.
- `privacy_audit_events` is append-only: no update route, no delete route, and
  metadata must never contain prompts, tokens, emails, attachments,
  screenshots, message content, or OAuth credentials.
- Never export OAuth tokens, refresh tokens, session tokens, API keys,
  encrypted token blobs, raw password hashes, or webhook secrets.
- External provider revocation is best effort but always recorded.
- Every personal-data table must have an owner, retention policy, export
  handler, and delete handler registered in the privacy registry; all future
  data stores must register before launch.
- New migration goes after `0022_dodo_cleanup_memory.sql`.
- Never log: full conversations, full prompts, OAuth tokens, API keys, refresh
  tokens, emails (unless owner-gated diagnostics), attachments, screenshots,
  voice transcripts, or Dodo webhook payloads containing customer data.

## Phase Sequencing

```
Phase A (Foundation: schema + registry + consent/preference APIs)
  -> Phase B (Consent Enforcement)      -> Phase C (Privacy Center UI)
  -> Phase D (Export)                    ->
  -> Phase E (Delete My Data + Connectors) -> Phase F (Delete Account)
  -> Phase G (Retention)
Phase H (Encryption & Logging Hardening) — mostly independent; can run in
parallel with B-G after A, except Better Auth token encryption which should
land before Delete Account (F) finalizes its cleanup list.
```

Phase A blocks everything. B, D, E, G all build on the registry from A and
are mutually independent. C (UI) needs B's consent APIs live. F needs E's
delete handlers. H is parallelizable.

---

## Phase A: Foundation

**Objective:** Ship the privacy schema, shared constants, service skeletons,
registry abstraction, and read/write consent + preference APIs — with audit
logging from day one.

**Files:**
- Create: `packages/shared/src/privacy.ts` — consent purpose constants:
  `conversation_history`, `memory`, `cloud_memory`, `connector_data`,
  `analytics`, `voice_processing`, `screen_processing`, `ai_improvement`,
  `telegram_processing`, `rag_processing`; plus policy/terms/consent version
  constants.
- Modify: `packages/db/src/schema.ts` — add:
  - `user` columns: `deleted_at`, `privacy_preferences jsonb default '{}'`,
    `consent_version`, `consent_timestamp`, `privacy_policy_version`,
    `terms_version`, `last_export_at`, `export_count` (convenience fields;
    `privacy_consents` is the source of truth).
  - `privacy_consents` (append-only history: `purpose`, `status`
    granted/revoked, `consent_version`, `privacy_policy_version`,
    `terms_version`, `app_version`, `ip_address`, `user_agent`, `metadata`,
    `created_at`; indexes `(user_id, purpose, created_at desc)` and
    `(user_id, status)`).
  - `privacy_preferences` (one row per user, all optional-processing booleans
    default `false`: `conversation_history_enabled`, `memory_enabled`,
    `cloud_memory_enabled`, `connectors_enabled`, `analytics_enabled`,
    `voice_processing_enabled`, `screen_processing_enabled`,
    `ai_improvement_enabled`, `retention_overrides jsonb`, `updated_at`).
  - `privacy_exports` (status queued/running/ready/failed/expired, `format`,
    `manifest`, `archive_url`, `archive_sha256`, `error`, timestamps).
  - `privacy_deletion_jobs` (kind delete_data/delete_account, status,
    `steps jsonb`, `error`, timestamps; NOT cascaded on user delete —
    pseudonymous `user_id` + step metadata only, no content).
  - `privacy_audit_events` (append-only: `actor_user_id`, `target_user_id`,
    `event_type`, `resource_type`, `resource_id`, `ip_address`, `user_agent`,
    redacted `metadata`, `created_at`).
- Create: `packages/db/drizzle/0023_*.sql` — migration after
  `0022_dodo_cleanup_memory.sql`.
- Create: `apps/backend/src/services/privacy/registry.ts` — the
  `PrivacyDataDomain` type and central registry:
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
- Create: `apps/backend/src/services/privacy/consent.ts` — grant/revoke/read;
  current state = latest event per purpose.
- Create: `apps/backend/src/services/privacy/preferences.ts` — read/update
  with safe defaults.
- Create: `apps/backend/src/services/privacy/audit.ts` — append-only helper
  that rejects content-like metadata keys.
- Create: `apps/backend/src/routes/privacy.ts` mounted at `/api/privacy` —
  Phase A endpoints: `GET /overview`, `GET /consents`, `POST /consents`,
  `POST /consents/revoke`, `GET /preferences`, `PATCH /preferences`,
  `GET /activity`. All behind `authenticate`.
- Modify: `apps/backend/src/index.ts` — mount the privacy router.

**Key interfaces produced:** `registerPrivacyDomain(domain)`,
`getPrivacyDomains()`, `getConsentState(userId)`, `grantConsent(...)`,
`revokeConsent(...)`, `getPreferences(userId)`, `updatePreferences(...)`,
`auditPrivacyEvent(...)` — every later phase consumes these.

**Tests:** consent history append-only; current state returns latest event per
purpose; preferences default safe; audit helper rejects content-like metadata
keys; all `/api/privacy/*` routes 401 without auth.

**Dependencies:** none.

---

## Phase B: Consent Enforcement

**Objective:** Optional processing is actually blocked server-side (and
skipped sidecar-side) unless the matching consent + preference is on.

**Files:**
- Modify: `apps/sidecar/src/memory/*` (`captureCloudMemory` and retrieval
  path in `subsystem.ts`) — preflight consent/preference check before
  extraction or retrieval.
- Modify: `apps/backend/src/routes/memory.ts` — gate `/add`, `/sync`,
  `/search`, `/profile` on memory/cloud-memory consent.
- Modify: `apps/backend/src/routes/rag.ts` — gate sync/search on
  `rag_processing`.
- Modify: conversation write path (`/api/conversation/shared/turn` route and
  backend agent-session appends in `apps/backend/src/services/
  agent-sessions.ts` / `apps/backend/src/agent/run.ts`) — gate on
  `conversation_history`.
- Modify: `apps/backend/src/gateway/gateway-runner.ts` — gate Telegram
  processing on `telegram_processing` after link; gate voice on
  `voice_processing`.
- Modify: connector connect flow in integration routes — gate on
  `connector_data`.
- Modify: desktop/dashboard first-run — consent UI shown after first
  authenticated session, before optional data processing (dashboard path in
  `apps/landing`, desktop prompt via sidecar/desktop handshake).

**Tests:** memory sync blocked without memory consent; conversation write
blocked without conversation consent; revocation takes effect on the next
request; essential processing (auth, billing) unaffected.

**Dependencies:** Phase A.

**Risks:** This changes live product behavior for existing users. The spec's
open question — pause processing for existing users until they respond to an
interstitial, vs. grandfathering — **must be decided before this phase is
planned in detail.** Recommend: interstitial with processing paused for
optional domains (cleanest DPDP posture), but this is a product call.

---

## Phase C: Privacy Center UI

**Objective:** A `Privacy` dashboard tab/route where users see and control
everything: consent status, data stored, export, deletion, memories,
connectors, retention, and recent privacy activity.

**Files:**
- Create: `apps/landing/src/app/dashboard/privacy/page.tsx` — sections per
  spec §8: Privacy Overview, Consent Status, Data Stored, Connected Apps,
  Memories, Storage Usage, Download My Data, Delete My Data, Delete Account,
  Manage Memories, Manage Connectors, Consent History, Privacy Policy, Terms,
  Data Retention, Security, Recent Privacy Activity.
- Modify: dashboard tab navigation — add `Privacy` entry.
- Reuse (do not duplicate): existing `MemoryManager`, connector marketplace,
  and conversation manager components.

**Tests:** Privacy Center loads overview; consent toggles call the correct
`/api/privacy` endpoints; export/deletion flows require confirmation; memory
and connector sections link to existing components.

**Dependencies:** Phase A (APIs); Phase B for toggles to have real effect.
Export/delete buttons can ship disabled/hidden until Phases D/E land, or this
phase can be scheduled after them — decide at phase-detail time.

---

## Phase D: Export My Data

**Objective:** User can download a complete JSON export of their data with
zero secrets included.

**Files:**
- Create: `apps/backend/src/services/privacy/export.ts` — builds manifest
  (`schemaVersion`, `generatedAt`, `userId`, `sections[]` with counts) and
  assembles sections via registry export handlers.
- Modify: `apps/backend/src/routes/privacy.ts` — add `POST /export`
  (synchronous JSON for phase 1 if payload is small; still records
  `privacy_exports` row + audit event), `GET /export/:id`,
  `GET /export/:id/download`.
- Modify: each domain registered in `registry.ts` gains its `export` handler,
  covering sections: `profile`, `consents`, `preferences`, `conversations`,
  `memories` (entries + provenance, no raw embedding vectors unless
  explicitly requested), `rag` (source/document metadata + chunk content),
  `schedules`, `connectors` (no tokens), `platform_connections`, `usage`,
  `billing`, `devices`, `audit_activity` (privacy events only).

**Tests:** export includes all expected sections; a reject-list test proves no
OAuth/refresh/session tokens, API keys, encrypted blobs, password hashes, or
webhook secrets appear anywhere in the export payload; export bumps
`user.last_export_at`/`export_count` and writes an audit event.

**Dependencies:** Phase A. Independent of B/C.

---

## Phase E: Delete My Data + Connector Cleanup

**Objective:** One-click deletion of optional product data (keeping account,
subscription, credits, and legally required billing records), with
provider-token revocation and step-level job reporting.

**Files:**
- Create: `apps/backend/src/services/privacy/deletion.ts` — orchestrator
  implementing the spec §9.2 transaction model: create job row → read
  connector credentials → attempt external revocations (recorded, best
  effort) → single DB transaction deleting by domain via registry → reset
  preferences to safe defaults → audit events → mark job completed. DB
  failure rolls back; revocation failure is recorded but does not block DB
  deletion.
- Create: `apps/backend/src/services/privacy/connectors.ts` —
  `ConnectorPrivacyHandler` (`provider`, `revoke?`, `deleteCache?`) with
  per-provider handlers: Google (revoke access/refresh token), GitHub (revoke
  OAuth token if app credentials allow), Notion/Slack/Linear (revoke where
  supported), API-key/DSN (delete encrypted row immediately).
- Modify: `DELETE /api/integrations/:provider` — delegate to the connector
  cleanup service and write audit events.
- Modify: `apps/backend/src/routes/privacy.ts` — add `POST /delete-data`,
  `GET /delete-data/:id`, `DELETE /memories` (delete-all-memories),
  `GET /memories/export`.
- Modify: registry domains gain `delete` handlers for: `agent_messages`,
  `agent_sessions`, all `memory_*`, all `rag_*`, `mcp_connections` + cached
  connector data, `platform_connections`, `pending_actions`, `schedules`,
  optional old `usage_events`, expired `linking_codes` /
  `telegram_link_tokens` / `device_codes`. Preserve: `user` row, current
  session, subscription state, credit ledger, payment records,
  `privacy_audit_events`.
- Modify: desktop/sidecar — local cache-clear command where possible.

**Tests:** integration test — create user with memory, RAG source,
conversation, schedule, connector, usage; run delete-my-data; assert every
registered domain reports zero remaining optional records while billing/
credits/account survive. Connector disconnect deletes credential row and
records audit event. Failed revocation still completes DB deletion with the
step marked failed.

**Dependencies:** Phase A (registry). Frontend flow with typed confirmation
lands in/with Phase C.

---

## Phase F: Delete Account

**Objective:** Full account closure: everything from delete-my-data plus Dodo
cancellation, Better Auth session/account/verification removal, and user-row
deletion or anonymization.

**Files:**
- Modify: `apps/backend/src/services/privacy/deletion.ts` — `delete_account`
  job kind implementing spec §10 steps: revoke connector tokens → disconnect
  platforms → run delete-my-data domains → cancel Dodo subscription (or mark
  cancellation requested) → revoke all Better Auth sessions → delete
  `account`/`session`/`verification` rows → delete or anonymize `user` row
  (if retained for billing reconciliation: email →
  `deleted+<hash>@deleted.yomi.local`, name → `Deleted User`, image → null)
  → pseudonymize billing records where legally allowed → audit event with
  pseudonymous target ID. Soft-set `user.deleted_at` first to block access
  immediately.
- Modify: `apps/backend/src/routes/privacy.ts` — `POST /delete-account` with
  re-authentication or typed confirmation required.
- Modify: `apps/landing` Privacy Center — re-auth/confirmation UI.

**Tests:** account deletion revokes sessions, removes optional data,
anonymizes/removes user row, preserves pseudonymized billing records; deleted
user cannot authenticate; audit event exists with pseudonymous ID.

**Dependencies:** Phase E (reuses its domain delete handlers and connector
revocation). Dodo cancellation behavior needs the spec's open legal question
answered (which billing records must be retained, for how long) — get a
product/legal answer before detail-planning this phase.

---

## Phase G: Retention

**Objective:** Automatic enforcement of the spec §13.1 retention defaults via
a scheduled job, with user-visible policy and preference overrides.

**Files:**
- Modify: `packages/db/src/schema.ts` + migration — add `retention_until` /
  `deleted_at` to priority tables: `agent_sessions`, `agent_messages`,
  `rag_sources`, `rag_documents`, `rag_chunks`, `rag_retrieval_logs`,
  `memory_entries`, `pending_actions`, `usage_events`, `devices`,
  `linking_codes`, `telegram_link_tokens`, `device_codes` (high-churn child
  tables may rely on parent `retention_until` + cascade).
- Create: `apps/backend/src/services/privacy/retention.ts` —
  `applyRetentionPolicies()` evaluating defaults (conversations 180d, voice
  transcripts 30d, screenshots 24h if persisted, raw temp uploads 7d, RAG
  indexed 180d unless pinned, retrieval logs 30d, usage events 90d detailed
  then aggregate, pending actions expiry+7d, devices 180d since last seen,
  audit events minimum 3 years) plus per-user `retention_overrides`.
  Bounded batches, no long cross-domain transactions, audit summary with
  counts only, never log deleted content.
- Modify: backend worker entry — cron handler invoking
  `applyRetentionPolicies()`; plus owner-only
  `POST /api/privacy/admin/run-retention` for local/dev.
- Modify: `apps/backend/src/routes/privacy.ts` — `GET /retention`,
  `PATCH /retention`.

**Tests:** retention deletes only expired data per domain; overrides
respected; audit summary contains counts, not content.

**Dependencies:** Phase A (registry `applyRetention` slots). Independent of
C-F.

---

## Phase H: Encryption and Logging Hardening

**Objective:** Close the encryption and logging gaps flagged in the audit:
Better Auth token storage, key rotation, and noisy/leaky logs.

**Files:**
- Investigate first: whether Better Auth `account.access_token` /
  `refresh_token` / `id_token` are stored plaintext (spec says schema exposes
  plaintext columns — verify). Then either configure Better Auth to avoid
  storing them, or encrypt via storage override. This is the spec's open
  question §26; resolve empirically during phase-detail planning.
- Modify: `apps/backend/src/services/token-encryption.ts` — add `key_version`
  / ciphertext envelope prefix; add rotation job that decrypts with
  `ENCRYPTION_KEY_FALLBACKS` and re-encrypts with primary. (Note: existing
  memory `project_encryption_key_mismatch` — dev vs prod `ENCRYPTION_KEY`
  differ on the same shared Neon DB — makes key versioning directly useful
  here; design the envelope so multi-key decryption solves that too.)
- Modify: `apps/backend/src/auth.ts` — remove or debug-gate the
  `customSession` `console.warn` logging user ID / trial end / subscription
  status on every session load.
- Modify: `apps/backend/src/routes/billing.ts` + Dodo webhook handling —
  strip personal fields from checkout/webhook logs.
- Modify: Telegram webhook logging in `gateway-runner.ts` — update ID okay,
  message text never.
- Add: redacted-logging helper + (where practical) lint/test check for known
  secret/content logging patterns.

**Tests:** encryption round-trip; fallback decryption of old-key ciphertext;
rotation rewrites rows to primary key; log-pattern check passes.

**Dependencies:** Phase A only nominally; can run in parallel with B-G.
Better Auth token handling should be resolved before Phase F finalizes its
account-deletion cleanup list.

---

## Documentation Deliverables (spec §22 — accrue per phase, not a phase of their own)

Create under `specs/privacy/` (or future `docs/privacy/`), each written by the
phase that makes it true: architecture + data inventory + data flow diagrams
(Phase A), consent flow (Phase B), export flow (Phase D), deletion flow
(Phases E/F), retention flow (Phase G), connector privacy guide (Phase E),
encryption/key-rotation guide + logging policy (Phase H), threat model +
security checklist + developer guide for registering new data domains
(Phase A, updated as domains are added).

## Final Acceptance (spec §24 — gate for the whole roadmap)

- Privacy Center available from dashboard.
- Grant/view/revoke consent with history.
- Data export downloadable with no secrets included.
- Delete product data without deleting billing/credit state.
- Delete account with sessions revoked and optional data removed.
- Manage, export, disable, and delete memories.
- Connector disconnect with token deletion and cache cleanup.
- Retention job enforces defaults.
- Audit events append-only and content-free.
- Sensitive tokens encrypted, rotation supported.
- Logs free of conversations, prompts, OAuth tokens, emails, screenshots,
  attachments.
- Tests cover consent, export, deletion, retention, connector cleanup, memory
  deletion, preferences, audit logs.

## Open Decisions Before Phase-Detail Planning (spec §26)

1. **Existing users at Phase B rollout:** opt-in interstitial with optional
   processing paused, or grandfather current behavior? (Product call;
   recommend interstitial for DPDP posture.)
2. **Billing record retention period:** which records, how long, per Yomi's
   operating jurisdictions? Blocks Phase F detail.
3. **Better Auth field-level encryption support:** verify empirically in
   Phase H before choosing configure-vs-override.
4. **Raw uploaded file persistence:** if files ever persist outside RAG
   chunks, object storage must join the privacy registry.
5. **Sync vs async export:** Phase D starts synchronous JSON; revisit if
   payloads grow.
