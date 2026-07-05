# Spec 23 Privacy Gap Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining DPDP-spec gaps: full domain retention sweeps, the missing `/api/privacy` retention + memories routes, broader connector token revocation, and the flagged auth log leak.

**Architecture:** Extend the existing (already substantial) privacy implementation in place: `services/privacy/retention.ts` grows domain sweeps driven by a shared defaults table in `packages/shared/src/privacy.ts`; `routes/privacy.ts` gains retention read/update, owner-only run-retention, and delete-all-memories endpoints; `services/privacy/deletion.ts` extends its Google-only revocation to GitHub/Slack/Linear.

**Tech Stack:** Hono/Bun on Cloudflare Workers, Drizzle + Neon (neon-http only), bun:test with `mock.module`.

## Global Constraints

- Privacy is enforced server-side; all new routes stay behind the router-wide `authenticate` middleware already applied in `routes/privacy.ts:57`.
- `privacy_audit_events` stays append-only and content-free — audit metadata carries counts/keys only, never message content, emails, tokens, or prompts.
- External provider revocation is best effort but always recorded in job steps.
- Retention job: bounded batches, no long cross-domain transactions, audit summary with counts only, never log deleted content (spec §13.2).
- Never log conversations, prompts, OAuth tokens, emails, attachments, screenshots, voice transcripts, or Dodo payloads (spec §16).
- Conventional commits: lowercase, no full stops, max 72 chars. **Per repo convention, commits are made by opencode — if executing inside Claude Code, stop at each task's verify step and hand off** (see `feedback_no_direct_commits`).
- Before pushing: `bun run ci` green, no unused imports, no `as any` outside tests.

## Prior-state notes (verified 2026-07-05)

Already implemented — do NOT rebuild: privacy schema (migration 0023), consent/preferences/export/deletion/audit/checks/logging services, `/api/privacy` consents/preferences/overview/exports/activity/delete-data/delete-account routes, consent gating in memory/rag/conversation/gateway/agent/integrations, dashboard privacy tab, worker cron calling `runPrivacyRetention()` (currently privacy-tables-only), Google token revocation in `deletion.ts:35`.

## Deliberate deviations from the spec (state in PR description)

- **No `retention_until` columns (spec §6.7)** in this pass: all implemented policies are pure age-based cutoffs computed at sweep time from `created_at` / `last_seen` / `expires_at`, which is idempotent and avoids churn on billing-adjacent tables. Add columns later only if per-row pinning ships.
- **RAG source/document 180-day retention is NOT enforced yet**: the spec's default is "180 days unless user pins", and no pin concept exists — silently deleting user documents without a pin escape hatch is worse than deferring. Tracked as an open decision.
- **Conversation retention defaults ON at 180 days** per spec; each domain sweep is individually controlled by a shared defaults table so product can tune without code changes.
- **Notion revocation**: Notion has no public token-revocation API — recorded as `skipped` in job steps rather than pretending.
- **`usage_events` 90-day cleanup deletes detail rows without pre-aggregation**: billing history survives in `credit_transactions` / `credit_grants`; spec's "aggregate after" is deferred to spec 22's telemetry work where aggregates get a real home.

## Out of scope (separate follow-up plans)

- Phase H key versioning/rotation job and Better Auth `account` token encryption (needs empirical verification of Better Auth storage first — spec §26 open question).
- GDPR/CCPA extensions, ZIP export, async export jobs.

---

### Task 1: Shared retention defaults

**Files:**
- Modify: `packages/shared/src/privacy.ts`

**Interfaces:**
- Produces: `RETENTION_DEFAULTS`, `type RetentionDomainKey`, `type RetentionPolicy` — consumed by Tasks 2 and 3.

- [ ] **Step 1: Append to `packages/shared/src/privacy.ts`**

```ts
// Default retention windows (spec 23 §13.1). days: null = keep until user
// deletes. userOverridable domains may be tightened (never extended) via
// privacy_preferences.retention_overrides = { [domain]: days }.
export type RetentionDomainKey =
  | "conversations"
  | "rag_retrieval_logs"
  | "usage_events"
  | "pending_actions"
  | "devices"
  | "expired_codes"

export type RetentionPolicy = {
  label: string
  days: number
  userOverridable: boolean
}

export const RETENTION_DEFAULTS: Record<RetentionDomainKey, RetentionPolicy> = {
  conversations: { label: "Conversation history", days: 180, userOverridable: true },
  rag_retrieval_logs: { label: "Search activity logs", days: 30, userOverridable: false },
  usage_events: { label: "Detailed usage events", days: 90, userOverridable: false },
  pending_actions: { label: "Pending action requests", days: 7, userOverridable: false },
  devices: { label: "Inactive device records", days: 180, userOverridable: false },
  expired_codes: { label: "Expired link/device codes", days: 0, userOverridable: false },
}

export function isRetentionDomainKey(value: string): value is RetentionDomainKey {
  return Object.prototype.hasOwnProperty.call(RETENTION_DEFAULTS, value)
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd packages/shared && bun run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit** (executor: opencode)

```bash
git add packages/shared/src/privacy.ts
git commit -m "feat: add shared retention policy defaults"
```

---

### Task 2: Domain retention sweeps

**Files:**
- Modify: `apps/backend/src/services/privacy/retention.ts`
- Test: `apps/backend/src/services/privacy/retention.test.ts` (create)

**Interfaces:**
- Consumes: `RETENTION_DEFAULTS` from Task 1; existing tables from `@yomi/db` (`agentMessages.createdAt`, `agentSessions.lastMessageAt`, `ragRetrievalLogs.createdAt`, `usageEvents.createdAt`, `pendingActions.expiresAt`, `devices.lastSeen`, `linkingCodes.expiresAt`, `telegramLinkTokens.expiresAt`, `deviceCodes.expiresAt`).
- Produces: extended `RetentionReport` with per-domain counts; `runPrivacyRetention()` keeps its existing signature (worker cron at `worker.ts:54` needs no change beyond the log line).

- [ ] **Step 1: Write failing test `retention.test.ts`**

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test"

const deleteCalls: Array<{ table: string }> = []

function fakeTable(name: string) {
  return { __name: name, createdAt: {}, expiresAt: {}, lastSeen: {}, lastMessageAt: {}, status: {}, completedAt: {}, deletedAt: {}, used: {} }
}

mock.module("@yomi/db", () => ({
  db: {
    delete: (table: { __name: string }) => ({
      where: () => ({
        returning: () => {
          deleteCalls.push({ table: table.__name })
          return Promise.resolve([])
        },
      }),
    }),
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => Promise.resolve() }),
  },
  privacyExports: fakeTable("privacy_exports"),
  privacyDeletionJobs: fakeTable("privacy_deletion_jobs"),
  privacyAuditEvents: fakeTable("privacy_audit_events"),
  agentMessages: fakeTable("agent_messages"),
  agentSessions: fakeTable("agent_sessions"),
  ragRetrievalLogs: fakeTable("rag_retrieval_logs"),
  usageEvents: fakeTable("usage_events"),
  pendingActions: fakeTable("pending_actions"),
  devices: fakeTable("devices"),
  linkingCodes: fakeTable("linking_codes"),
  telegramLinkTokens: fakeTable("telegram_link_tokens"),
  deviceCodes: fakeTable("device_codes"),
}))

mock.module("../../auth-schema.js", () => ({
  user: fakeTable("user"),
}))

const { runPrivacyRetention } = await import("./retention.js")

beforeEach(() => {
  deleteCalls.length = 0
})

describe("runPrivacyRetention domain sweeps", () => {
  it("sweeps every retention domain", async () => {
    const report = await runPrivacyRetention()
    const swept = deleteCalls.map((c) => c.table)
    for (const table of [
      "agent_messages",
      "rag_retrieval_logs",
      "usage_events",
      "pending_actions",
      "devices",
      "linking_codes",
      "telegram_link_tokens",
      "device_codes",
    ]) {
      expect(swept).toContain(table)
    }
    expect(report.domains["conversations"]).toBe(0)
    expect(report.domains["expired_codes"]).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && bun test src/services/privacy/retention.test.ts`
Expected: FAIL — `report.domains` undefined, missing sweeps.

- [ ] **Step 3: Implement in `retention.ts`**

Extend imports and the report type, keeping the four existing privacy-table sweeps untouched:

```ts
import { and, eq, lt, lte } from "drizzle-orm"
import {
  agentMessages,
  agentSessions,
  db,
  deviceCodes,
  devices,
  linkingCodes,
  pendingActions,
  privacyAuditEvents,
  privacyDeletionJobs,
  privacyExports,
  ragRetrievalLogs,
  telegramLinkTokens,
  usageEvents,
} from "@yomi/db"
import { RETENTION_DEFAULTS, type RetentionDomainKey } from "@yomi/shared/privacy"
import * as authSchema from "../../auth-schema.js"

export type RetentionReport = {
  expiredExports: number
  oldDeletionJobs: number
  hardDeletedUsers: number
  oldAuditEvents: number
  domains: Record<RetentionDomainKey, number>
}

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}
```

Append the domain sweeps at the end of `runPrivacyRetention()` before `return report` (initialize `domains` in the report literal with all keys at 0):

```ts
  // ── Domain retention sweeps (spec 23 §13.1) ─────────────────────────
  const conversationCutoff = cutoff(RETENTION_DEFAULTS.conversations.days)
  report.domains.conversations = (
    await db
      .delete(agentMessages)
      .where(lt(agentMessages.createdAt, conversationCutoff))
      .returning({ id: agentMessages.id })
  ).length
  // Sessions with no activity past the window (messages above are already gone).
  await db
    .delete(agentSessions)
    .where(lt(agentSessions.lastMessageAt, conversationCutoff))
    .returning({ id: agentSessions.id })

  report.domains.rag_retrieval_logs = (
    await db
      .delete(ragRetrievalLogs)
      .where(lt(ragRetrievalLogs.createdAt, cutoff(RETENTION_DEFAULTS.rag_retrieval_logs.days)))
      .returning({ id: ragRetrievalLogs.id })
  ).length

  report.domains.usage_events = (
    await db
      .delete(usageEvents)
      .where(lt(usageEvents.createdAt, cutoff(RETENTION_DEFAULTS.usage_events.days)))
      .returning({ id: usageEvents.id })
  ).length

  // Pending actions: expired + grace window (spec: expiry plus 7 days).
  report.domains.pending_actions = (
    await db
      .delete(pendingActions)
      .where(lt(pendingActions.expiresAt, cutoff(RETENTION_DEFAULTS.pending_actions.days)))
      .returning({ id: pendingActions.id })
  ).length

  report.domains.devices = (
    await db
      .delete(devices)
      .where(lt(devices.lastSeen, cutoff(RETENTION_DEFAULTS.devices.days)))
      .returning({ id: devices.id })
  ).length

  const now = new Date()
  const expiredCodes =
    (
      await db
        .delete(linkingCodes)
        .where(lt(linkingCodes.expiresAt, now))
        .returning({ code: linkingCodes.code })
    ).length +
    (
      await db
        .delete(telegramLinkTokens)
        .where(lt(telegramLinkTokens.expiresAt, now))
        .returning({ token: telegramLinkTokens.token })
    ).length +
    (
      await db
        .delete(deviceCodes)
        .where(lt(deviceCodes.expiresAt, now))
        .returning({ deviceCode: deviceCodes.deviceCode })
    ).length
  report.domains.expired_codes = expiredCodes
```

Also append a counts-only audit event at the very end (before `return`):

```ts
  await db
    .insert(privacyAuditEvents)
    .values({
      eventType: "privacy.retention.completed",
      metadata: { ...report.domains, exports: report.expiredExports },
    })
    .catch?.(() => {})
```

(If `.catch` isn't chainable on the insert builder in this codebase, wrap in `try {} catch { /* best-effort */ }` instead — match the file's existing style.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && bun test src/services/privacy/retention.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the worker log line**

In `worker.ts:69`, extend the summary log with the new counts, keeping counts-only:

```ts
                `[retention] cleaned ${total} items (exports:${r.expiredExports} jobs:${r.oldDeletionJobs} users:${r.hardDeletedUsers} audit:${r.oldAuditEvents} convo:${r.domains.conversations} raglogs:${r.domains.rag_retrieval_logs} usage:${r.domains.usage_events} pending:${r.domains.pending_actions} devices:${r.domains.devices} codes:${r.domains.expired_codes})`,
```

- [ ] **Step 6: Commit** (executor: opencode)

```bash
git add apps/backend/src/services/privacy/retention.ts apps/backend/src/services/privacy/retention.test.ts apps/backend/src/worker.ts
git commit -m "feat: add domain retention sweeps to privacy retention job"
```

---

### Task 3: Retention routes + owner-only run-retention

**Files:**
- Modify: `apps/backend/src/routes/privacy.ts`
- Test: extend `apps/backend/src/services/privacy/retention.test.ts` is not needed; add route tests to a new `apps/backend/src/routes/privacy-retention.test.ts`

**Interfaces:**
- Consumes: `RETENTION_DEFAULTS`, `isRetentionDomainKey` (Task 1); `runPrivacyRetention` (Task 2); existing `getPrivacyPreferences`/`updatePrivacyPreferences`; `isOwnerUser` from `../entitlements.js`.
- Produces: `GET /api/privacy/retention`, `PATCH /api/privacy/retention`, `POST /api/privacy/admin/run-retention`.

- [ ] **Step 1: Write failing route tests `privacy-retention.test.ts`**

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test"

let currentUser = { id: "u1", email: "user@example.com", role: "user" }
let ownerEmails = ["owner@example.com"]
let retentionRunCount = 0
let storedOverrides: Record<string, unknown> | null = null

mock.module("../auth.js", () => ({
  authenticate: async (c: any, next: () => Promise<void>) => {
    c.set("user", currentUser)
    await next()
  },
}))

mock.module("../entitlements.js", () => ({
  isOwnerUser: (u: { email: string }) => ownerEmails.includes(u.email),
}))

mock.module("../services/privacy/retention.js", () => ({
  runPrivacyRetention: async () => {
    retentionRunCount++
    return {
      expiredExports: 0,
      oldDeletionJobs: 0,
      hardDeletedUsers: 0,
      oldAuditEvents: 0,
      domains: {
        conversations: 0,
        rag_retrieval_logs: 0,
        usage_events: 0,
        pending_actions: 0,
        devices: 0,
        expired_codes: 0,
      },
    }
  },
}))

mock.module("../services/privacy/preferences.js", () => ({
  getPrivacyPreferences: async () => ({ retentionOverrides: storedOverrides }),
  updatePrivacyPreferences: async (_id: string, patch: Record<string, unknown>) => {
    storedOverrides = patch["retentionOverrides"] as Record<string, unknown> | null
    return { retentionOverrides: storedOverrides }
  },
}))

// Stub the remaining imports of routes/privacy.ts so the module loads.
mock.module("@yomi/db", () => ({ db: {}, agentMessages: {}, agentSessions: {}, mcpConnections: {}, memoryEntries: {}, memoryEmbeddings: {}, memoryRelations: {}, memorySources: {}, platformConnections: {}, privacyAuditEvents: {}, ragChunks: {}, ragSources: {}, schedules: {}, usageEvents: {} }))
mock.module("../services/privacy/audit.js", () => ({
  clientIp: () => null,
  userAgent: () => null,
  listPrivacyActivity: async () => [],
  recordPrivacyAuditEvent: async () => {},
}))
mock.module("../services/privacy/consent.js", () => ({
  getConsentSnapshot: async () => [],
  listConsentHistory: async () => [],
  recordConsentDecision: async () => [],
}))
mock.module("../services/privacy/export.js", () => ({
  getExport: async () => null,
  listExports: async () => [],
  requestExport: async () => ({}),
}))
mock.module("../services/privacy/deletion.js", () => ({
  deleteMyData: async () => null,
  deleteAccount: async () => null,
  getDeletionJob: async () => null,
  listDeletionJobs: async () => [],
}))

const { privacyRouter } = await import("./privacy.js")

function req(path: string, init?: RequestInit) {
  return privacyRouter.request(path, init)
}

beforeEach(() => {
  retentionRunCount = 0
  storedOverrides = null
  currentUser = { id: "u1", email: "user@example.com", role: "user" }
})

describe("retention routes", () => {
  it("GET /retention returns defaults and overrides", async () => {
    const res = await req("/retention")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { defaults: Record<string, unknown> }
    expect(body.defaults["conversations"]).toBeDefined()
  })

  it("PATCH /retention rejects unknown domains and extended windows", async () => {
    const bad = await req("/retention", {
      method: "PATCH",
      body: JSON.stringify({ overrides: { nonsense: 10 } }),
    })
    expect(bad.status).toBe(400)
    const tooLong = await req("/retention", {
      method: "PATCH",
      body: JSON.stringify({ overrides: { conversations: 9999 } }),
    })
    expect(tooLong.status).toBe(400)
  })

  it("PATCH /retention stores a valid tightening override", async () => {
    const res = await req("/retention", {
      method: "PATCH",
      body: JSON.stringify({ overrides: { conversations: 30 } }),
    })
    expect(res.status).toBe(200)
    expect(storedOverrides).toEqual({ conversations: 30 })
  })

  it("POST /admin/run-retention is owner-only", async () => {
    const denied = await req("/admin/run-retention", { method: "POST" })
    expect(denied.status).toBe(403)
    expect(retentionRunCount).toBe(0)
    currentUser = { id: "u2", email: "owner@example.com", role: "user" }
    const ok = await req("/admin/run-retention", { method: "POST" })
    expect(ok.status).toBe(200)
    expect(retentionRunCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && bun test src/routes/privacy-retention.test.ts`
Expected: FAIL — 404s for the missing routes.

- [ ] **Step 3: Implement routes in `routes/privacy.ts`**

Add imports:

```ts
import { RETENTION_DEFAULTS, isRetentionDomainKey } from "@yomi/shared/privacy"
import { isOwnerUser } from "../entitlements.js"
import { runPrivacyRetention } from "../services/privacy/retention.js"
```

Add the handlers before the `/delete-data` routes:

```ts
privacyRouter.get("/retention", async (c) => {
  const user = c.get("user")
  const prefs = await getPrivacyPreferences(user.id)
  return c.json({ defaults: RETENTION_DEFAULTS, overrides: prefs.retentionOverrides ?? {} })
})

privacyRouter.patch("/retention", async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as { overrides?: unknown }
  if (!body.overrides || typeof body.overrides !== "object" || Array.isArray(body.overrides)) {
    return c.json({ error: "overrides object is required" }, 400)
  }
  const overrides: Record<string, number> = {}
  for (const [key, value] of Object.entries(body.overrides as Record<string, unknown>)) {
    if (!isRetentionDomainKey(key)) return c.json({ error: `Unknown domain: ${key}` }, 400)
    const policy = RETENTION_DEFAULTS[key]
    if (!policy.userOverridable) return c.json({ error: `${key} is not overridable` }, 400)
    const days = typeof value === "number" ? Math.floor(value) : NaN
    // Overrides may only tighten retention, never extend past the default.
    if (!Number.isFinite(days) || days < 1 || days > policy.days) {
      return c.json({ error: `${key} must be between 1 and ${policy.days} days` }, 400)
    }
    overrides[key] = days
  }
  const preferences = await updatePrivacyPreferences(user.id, { retentionOverrides: overrides })
  await recordPrivacyAuditEvent({
    actorUserId: user.id,
    targetUserId: user.id,
    eventType: "privacy.retention.updated",
    ipAddress: clientIp(c),
    userAgent: userAgent(c),
    metadata: { domains: Object.keys(overrides) },
  })
  return c.json({ preferences })
})

privacyRouter.post("/admin/run-retention", async (c) => {
  const user = c.get("user")
  if (!isOwnerUser(user)) return c.json({ error: "Owner access required" }, 403)
  const report = await runPrivacyRetention()
  await recordPrivacyAuditEvent({
    actorUserId: user.id,
    eventType: "privacy.retention.manual_run",
    ipAddress: clientIp(c),
    userAgent: userAgent(c),
    metadata: { ...report.domains },
  })
  return c.json({ report })
})
```

Note: per-user `retention_overrides` are stored here; Task 2's global sweeps use defaults. Applying per-user tightening inside the sweep is a follow-up — record it in the PR description (defaults are the DPDP floor; overrides only tighten, so shipping enforcement later is safe-side).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && bun test src/routes/privacy-retention.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit** (executor: opencode)

```bash
git add apps/backend/src/routes/privacy.ts apps/backend/src/routes/privacy-retention.test.ts
git commit -m "feat: add retention routes and owner run-retention endpoint"
```

---

### Task 4: Delete-all-memories + memories export endpoints

**Files:**
- Modify: `apps/backend/src/routes/privacy.ts`
- Test: `apps/backend/src/routes/privacy-memories.test.ts` (create; same mock scaffold as Task 3's test — copy it)

**Interfaces:**
- Consumes: `memoryEntries`, `memoryEmbeddings`, `memoryRelations`, `memorySources` from `@yomi/db` (embeddings/relations/sources cascade from entries per schema `onDelete: "cascade"` — verify in `packages/db/src/schema.ts` before relying on it; if any lacks the cascade, delete it explicitly first, mirroring the order used in `services/privacy/deletion.ts:84-86`).
- Produces: `DELETE /api/privacy/memories`, `GET /api/privacy/memories/export`.

- [ ] **Step 1: Write failing tests**

Copy Task 3's mock scaffold into `privacy-memories.test.ts`, but make the `@yomi/db` mock record deletes and return rows for selects:

```ts
const deletedTables: string[] = []
mock.module("@yomi/db", () => ({
  db: {
    delete: (table: { __name: string }) => ({
      where: () => ({
        returning: () => {
          deletedTables.push(table.__name)
          return Promise.resolve([{ id: "m1" }, { id: "m2" }])
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve([
            { id: "m1", topic: "prefs", content: "likes tea", createdAt: new Date() },
          ]),
        }),
      }),
    }),
  },
  memoryEntries: { __name: "memory_entries", userId: {}, id: {}, topic: {}, content: {}, createdAt: {} },
  memoryEmbeddings: { __name: "memory_embeddings", memoryId: {} },
  memoryRelations: { __name: "memory_relations" },
  memorySources: { __name: "memory_sources" },
  /* ...remaining table stubs as in Task 3's scaffold... */
}))
```

Tests:

```ts
describe("privacy memories endpoints", () => {
  it("DELETE /memories hard-deletes all entries and audits a count", async () => {
    const res = await req("/memories", { method: "DELETE" })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { deleted: number }
    expect(body.deleted).toBe(2)
    expect(deletedTables).toContain("memory_entries")
  })

  it("GET /memories/export returns entries without embedding vectors", async () => {
    const res = await req("/memories/export")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { memories: Array<Record<string, unknown>> }
    expect(body.memories.length).toBe(1)
    expect(body.memories[0]!["embedding"]).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && bun test src/routes/privacy-memories.test.ts`
Expected: FAIL — 404s.

- [ ] **Step 3: Implement in `routes/privacy.ts`**

Add `memoryEmbeddings`, `memoryRelations`, `memorySources`, and `desc` to the existing `@yomi/db` / drizzle imports, then:

```ts
privacyRouter.delete("/memories", async (c) => {
  const user = c.get("user")
  // Hard delete: entries first would orphan children if any table lacks the
  // cascade, so remove children explicitly (same order as deletion.ts).
  const entryIds = await db
    .select({ id: memoryEntries.id })
    .from(memoryEntries)
    .where(eq(memoryEntries.userId, user.id))
  if (entryIds.length) {
    await db.delete(memoryEmbeddings).where(eq(memoryEmbeddings.userId, user.id))
    await db.delete(memoryRelations).where(eq(memoryRelations.userId, user.id))
    await db.delete(memorySources).where(eq(memorySources.userId, user.id))
  }
  const deleted = await db
    .delete(memoryEntries)
    .where(eq(memoryEntries.userId, user.id))
    .returning({ id: memoryEntries.id })
  await recordPrivacyAuditEvent({
    actorUserId: user.id,
    targetUserId: user.id,
    eventType: "privacy.memories.deleted_all",
    ipAddress: clientIp(c),
    userAgent: userAgent(c),
    metadata: { count: deleted.length },
  })
  return c.json({ deleted: deleted.length })
})

privacyRouter.get("/memories/export", async (c) => {
  const user = c.get("user")
  const memories = await db
    .select({
      id: memoryEntries.id,
      topic: memoryEntries.topic,
      content: memoryEntries.content,
      createdAt: memoryEntries.createdAt,
    })
    .from(memoryEntries)
    .where(eq(memoryEntries.userId, user.id))
    .orderBy(desc(memoryEntries.createdAt))
  await recordPrivacyAuditEvent({
    actorUserId: user.id,
    targetUserId: user.id,
    eventType: "privacy.memories.exported",
    ipAddress: clientIp(c),
    userAgent: userAgent(c),
    metadata: { count: memories.length },
  })
  return c.json({ memories })
})
```

**Before finalizing:** check `packages/db/src/schema.ts` for the exact child-table column names (`memoryEmbeddings.userId` vs `.memoryId` etc. — `memory.ts:87` deletes embeddings by `memoryId`, so if there is no `userId` column on `memory_embeddings`, delete via `inArray(memoryEmbeddings.memoryId, entryIds.map((r) => r.id))` instead, importing `inArray` from drizzle). Match reality, and mirror whatever `deletion.ts` does for these tables since it already solved this.

Also verify `memoryEntries.topic` matches the schema column name (it is used in `memory.ts:593`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && bun test src/routes/privacy-memories.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (executor: opencode)

```bash
git add apps/backend/src/routes/privacy.ts apps/backend/src/routes/privacy-memories.test.ts
git commit -m "feat: add delete-all and export endpoints for memories"
```

---

### Task 5: Broader connector token revocation

**Files:**
- Modify: `apps/backend/src/services/privacy/deletion.ts` (extend the revocation step, currently Google-only at lines 33–51 and its call sites at 117 and 359)

**Interfaces:**
- Consumes: existing `decryptTokens` from `../token-encryption.js`, `mcpConnections` rows.
- Produces: `revokeConnectorTokens(userId): Promise<ConnectorRevocationSummary>` replacing `revokeGoogleTokens` at both call sites; per-provider results recorded in the job step.

- [ ] **Step 1: Implement `revokeConnectorTokens` in `deletion.ts`**

Replace the `GOOGLE_REVOKE_URL` block (lines 33–51) with:

```ts
type ConnectorRevocationSummary = {
  attempted: number
  revoked: string[]
  failed: string[]
  skipped: string[]
}

const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"

async function revokeProviderToken(provider: string, accessToken: string): Promise<boolean> {
  if (provider === "google") {
    const res = await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(accessToken)}`, {
      method: "POST",
    })
    return res.ok
  }
  if (provider === "github") {
    const clientId = process.env["GITHUB_CLIENT_ID"]
    const clientSecret = process.env["GITHUB_CLIENT_SECRET"]
    if (!clientId || !clientSecret) return false
    const res = await fetch(`https://api.github.com/applications/${clientId}/token`, {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ access_token: accessToken }),
    })
    return res.status === 204
  }
  if (provider === "slack") {
    const res = await fetch("https://slack.com/api/auth.revoke", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return false
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean }
    return json.ok === true
  }
  if (provider === "linear") {
    const res = await fetch("https://api.linear.app/oauth/revoke", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    return res.ok
  }
  // notion and API-key/DSN connectors: no public revocation API — the encrypted
  // credential row is deleted by the mcp_connections step; report as skipped.
  return false
}

const REVOCABLE_PROVIDERS = new Set(["google", "github", "slack", "linear"])

async function revokeConnectorTokens(userId: string): Promise<ConnectorRevocationSummary> {
  const summary: ConnectorRevocationSummary = { attempted: 0, revoked: [], failed: [], skipped: [] }
  const rows = await db
    .select({ provider: mcpConnections.provider, oauthTokens: mcpConnections.oauthTokens })
    .from(mcpConnections)
    .where(eq(mcpConnections.userId, userId))

  for (const row of rows) {
    if (!REVOCABLE_PROVIDERS.has(row.provider)) {
      summary.skipped.push(row.provider)
      continue
    }
    summary.attempted++
    try {
      const tok = decryptTokens(row.oauthTokens)
      const ok = await revokeProviderToken(row.provider, tok.accessToken)
      if (ok) summary.revoked.push(row.provider)
      else summary.failed.push(row.provider)
    } catch {
      // best-effort revoke
      summary.failed.push(row.provider)
    }
  }
  return summary
}
```

- [ ] **Step 2: Update both call sites**

At lines ~117 and ~359, replace:

```ts
    const result = await runDeletionStep(step, () => revokeGoogleTokens(userId).then(() => 0))
```

with:

```ts
    const result = await runDeletionStep(step, async () => {
      const summary = await revokeConnectorTokens(userId)
      step.error = summary.failed.length ? `failed: ${summary.failed.join(",")}` : undefined
      return summary.revoked.length
    })
```

(Keep whatever the surrounding code does with `result` unchanged.)

- [ ] **Step 3: Verify**

Run: `cd apps/backend && bun test && bun run typecheck`
Expected: PASS — existing deletion tests (if any) still green; no type errors. If `decryptTokens`' return type doesn't expose `accessToken` for all providers, check `token-encryption.ts` for the actual shape and adjust (`tok.accessToken ?? tok.access_token` style unions are NOT acceptable — read the real type).

- [ ] **Step 4: Commit** (executor: opencode)

```bash
git add apps/backend/src/services/privacy/deletion.ts
git commit -m "feat: revoke github slack linear tokens in deletion jobs"
```

---

### Task 6: Remove the customSession log leak

**Files:**
- Modify: `apps/backend/src/auth.ts` (lines 133–135)

- [ ] **Step 1: Delete the noisy log**

Remove these three lines from the `customSession` callback:

```ts
        console.warn(
          `[auth/customSession] userId=${session.user.id} trialEndDate=${fields?.trialEndDate} subscriptionStatus=${fields?.subscriptionStatus}`,
        )
```

(Spec §16 flags this as an immediate cleanup target: user ID + subscription status logged on every session load.)

- [ ] **Step 2: Verify**

Run: `cd apps/backend && bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Full CI gate, then commit** (executor: opencode)

Run: `bun run ci` at repo root — must be green.

```bash
git add apps/backend/src/auth.ts
git commit -m "fix: remove per-session user status log from customSession"
```

---

## Self-review checklist (done at plan time)

- Spec §20 route surface after this plan: only `GET /export/:id/download` remains unimplemented as a distinct route (current `GET /exports/:id` returns the export row; splitting out a download route belongs with the future ZIP/async export work — noted in Out of scope).
- Deviations (retention_until, RAG retention, Notion, usage aggregation) are declared up top with rationale, not silently dropped.
- Type consistency: `RetentionDomainKey`/`RETENTION_DEFAULTS` names match between Tasks 1, 2, 3; `revokeConnectorTokens` replaces `revokeGoogleTokens` at both call sites.
- Both new test files stub every import of `routes/privacy.ts` so `mock.module` isolation works — copy the scaffold exactly.
