# Spec 22 Phase 1: AI Telemetry Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every billable AI call persists rich telemetry (tokens, latency, first-token latency, tool calls, connector IDs, vision/voice counts, cost micros) into a new additive `ai_usage_events` table, with zero change to credit charges or user-visible behavior.

**Architecture:** A new Drizzle table + `ai-telemetry.ts` backend service. The existing reserve→finalize flow already carries tokens from sidecar to backend (`/api/usage/interactions/finalize`) and from the Telegram agent (`onUsage` callback in `agent/run.ts`) — we extend those existing paths to *also* write an `ai_usage_events` row, rather than building a parallel pipeline. Sidecar changes are limited to enriching the metadata it already sends.

**Tech Stack:** Hono/Bun on Cloudflare Workers, Drizzle + Neon (neon-http only — `Pool` is banned), bun:test with `mock.module`.

## Global Constraints

- Do NOT store raw prompt content, message text, transcripts, screenshots, or attachments in telemetry — counts, hashes, categories, redacted metadata only (spec 22 Non-Goals).
- Do NOT modify the `usage_events` table or `chargeUsage()` behavior — `ai_usage_events` is purely additive; credit charges are unchanged in this phase.
- Cost estimates in micros (integers), never floats.
- `/api/usage/interactions/reserve` and `/finalize` must stay backward compatible — old sidecar builds that send no telemetry block must keep working.
- CF Workers rules: no `Pool`, no module-level Request/Response/stream refs, only plain data at module scope (AGENTS.md).
- Conventional commits: lowercase, no full stops, max 72 chars. **Per repo convention, commits are made by opencode — if executing inside Claude Code, stop at the verify step of each task and hand off staged changes instead of committing** (see `feedback_no_direct_commits`).
- Before pushing: `bun run ci` green (or `gh run list` green), no unused imports, no `as any` outside tests.

## Prior-state notes (verified 2026-07-05, read before implementing)

- `usage_events` already has model/inputTokens/outputTokens/status/metadata, and `POST /api/usage/interactions/finalize` (`apps/backend/src/routes/usage.ts:98`) already updates them.
- Sidecar `fast.ts:518` / `agent.ts:495` already call `finalizeInteractionUsage()` with tokens, latencyMs, toolCalls in metadata.
- Telegram `agent/run.ts:526` already updates `usage_events` via `onUsage`.
- What's genuinely missing: the rich companion table, request-id idempotency, first-token latency, connector IDs, vision/voice counts, cost micros, and telemetry for gateway image/voice calls.

## Out of scope for this plan (later Phase-1b slice)

- Embedding telemetry for `routes/memory.ts` / `routes/rag.ts` (needs a read of their embed call sites first).
- `routes/llm.ts` raw proxy (pending the open decision on whether it's production-reachable).
- Compressor and cron-executor telemetry (Phase 5 territory alongside their `maxTokens` work).

---

### Task 1: `ai_usage_events` schema + migration

**Files:**
- Modify: `packages/db/src/schema.ts` (append after `privacyAuditEvents`, ~line 700)
- Create: `packages/db/drizzle/0024_ai_usage_events.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Produces: exported Drizzle table `aiUsageEvents` — consumed by Task 2's service and every later task.

- [ ] **Step 1: Add the table to `packages/db/src/schema.ts`**

Append after the `privacyAuditEvents` table definition, following the existing style (`text("user_id")` FK matching `agentMessages`):

```ts
// Rich per-request AI telemetry. Additive companion to usage_events — never
// billing-critical. request_id gives idempotency for retried finalizations.
export const aiUsageEvents = pgTable(
  "ai_usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usageEventId: uuid("usage_event_id").references(() => usageEvents.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    endpoint: text("endpoint").notNull(), // "sidecar.fast" | "sidecar.agent" | "backend.agent" | "gateway.image" | "gateway.voice"
    surface: text("surface").notNull(), // "desktop" | "telegram" | "dashboard" | "cron" | "backend"
    route: text("route"), // "fast" | "agent" | "gateway"
    intent: text("intent"),
    complexity: text("complexity"),
    model: text("model"),
    provider: text("provider"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    embeddingTokens: integer("embedding_tokens").notNull().default(0),
    maxOutputTokens: integer("max_output_tokens").notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),
    connectorCount: integer("connector_count").notNull().default(0),
    connectorIds: text("connector_ids").array().notNull().default([]),
    visionImages: integer("vision_images").notNull().default(0),
    voiceDurationSeconds: integer("voice_duration_seconds").notNull().default(0),
    ttsChars: integer("tts_chars").notNull().default(0),
    sttAudioSeconds: integer("stt_audio_seconds").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    firstTokenLatencyMs: integer("first_token_latency_ms"),
    totalApiCostMicros: integer("total_api_cost_micros").notNull().default(0),
    creditPolicyVersion: text("credit_policy_version").notNull().default("static-v1"),
    creditsEstimated: integer("credits_estimated").notNull().default(0),
    creditsCharged: integer("credits_charged").notNull().default(0),
    status: text("status").notNull().default("started"), // "started" | "done" | "error" | "cancelled"
    errorCode: text("error_code"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => ({
    requestIdUq: unique("ai_usage_events_request_id_uq").on(t.requestId),
    userCreatedIdx: index("ai_usage_events_user_created_idx").on(t.userId, t.createdAt),
    endpointIdx: index("ai_usage_events_endpoint_idx").on(t.endpoint, t.createdAt),
    modelIdx: index("ai_usage_events_model_idx").on(t.model, t.createdAt),
    statusIdx: index("ai_usage_events_status_idx").on(t.status),
    usageEventIdx: index("ai_usage_events_usage_event_idx").on(t.usageEventId),
  }),
)
```

- [ ] **Step 2: Create `packages/db/drizzle/0024_ai_usage_events.sql`**

Hand-written idempotent SQL matching the 0023 style:

```sql
-- 0024 — ai_usage_events: rich per-request AI telemetry (spec 22 phase 1)
-- Additive companion to usage_events. Idempotent for safe deploys.

create table if not exists "ai_usage_events" (
  "id" uuid primary key default gen_random_uuid(),
  "usage_event_id" uuid references "usage_events"("id") on delete set null,
  "user_id" text not null references "user"("id") on delete cascade,
  "request_id" text not null,
  "endpoint" text not null,
  "surface" text not null,
  "route" text,
  "intent" text,
  "complexity" text,
  "model" text,
  "provider" text,
  "input_tokens" integer not null default 0,
  "output_tokens" integer not null default 0,
  "reasoning_tokens" integer not null default 0,
  "cached_input_tokens" integer not null default 0,
  "embedding_tokens" integer not null default 0,
  "max_output_tokens" integer not null default 0,
  "tool_calls" integer not null default 0,
  "connector_count" integer not null default 0,
  "connector_ids" text[] not null default '{}',
  "vision_images" integer not null default 0,
  "voice_duration_seconds" integer not null default 0,
  "tts_chars" integer not null default 0,
  "stt_audio_seconds" integer not null default 0,
  "latency_ms" integer not null default 0,
  "first_token_latency_ms" integer,
  "total_api_cost_micros" integer not null default 0,
  "credit_policy_version" text not null default 'static-v1',
  "credits_estimated" integer not null default 0,
  "credits_charged" integer not null default 0,
  "status" text not null default 'started',
  "error_code" text,
  "metadata" jsonb,
  "created_at" timestamp not null default now(),
  "completed_at" timestamp
);
--> statement-breakpoint
create unique index if not exists "ai_usage_events_request_id_uq"
  on "ai_usage_events" ("request_id");
--> statement-breakpoint
create index if not exists "ai_usage_events_user_created_idx"
  on "ai_usage_events" ("user_id", "created_at");
--> statement-breakpoint
create index if not exists "ai_usage_events_endpoint_idx"
  on "ai_usage_events" ("endpoint", "created_at");
--> statement-breakpoint
create index if not exists "ai_usage_events_model_idx"
  on "ai_usage_events" ("model", "created_at");
--> statement-breakpoint
create index if not exists "ai_usage_events_status_idx"
  on "ai_usage_events" ("status");
--> statement-breakpoint
create index if not exists "ai_usage_events_usage_event_idx"
  on "ai_usage_events" ("usage_event_id");
```

- [ ] **Step 3: Register the migration in `packages/db/drizzle/meta/_journal.json`**

Append to the `entries` array (after the `0023_privacy_foundation` entry):

```json
    {
      "idx": 24,
      "version": "7",
      "when": 1783209600000,
      "tag": "0024_ai_usage_events",
      "breakpoints": true
    }
```

- [ ] **Step 4: Verify typecheck**

Run: `cd packages/db && bun run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 5: Commit** (executor per repo convention — opencode)

```bash
git add packages/db/src/schema.ts packages/db/drizzle/0024_ai_usage_events.sql packages/db/drizzle/meta/_journal.json
git commit -m "feat: add ai_usage_events telemetry table"
```

---

### Task 2: `ai-telemetry` service with metadata sanitization

**Files:**
- Create: `apps/backend/src/services/ai-telemetry.ts`
- Test: `apps/backend/src/services/ai-telemetry.test.ts`

**Interfaces:**
- Consumes: `aiUsageEvents` table from Task 1.
- Produces (used by Tasks 3, 4, 5):
  - `sanitizeTelemetryMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> | null`
  - `recordAiUsage(input: AiUsageRecord): Promise<void>` — one-shot insert of a completed event, idempotent on `requestId` (conflict → no-op). Never throws.
  - `type AiUsageRecord` — see code below.

- [ ] **Step 1: Write the failing test `apps/backend/src/services/ai-telemetry.test.ts`**

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test"

type InsertCall = { values: Record<string, unknown> }
const insertCalls: InsertCall[] = []
let failNextInsert = false

mock.module("@yomi/db", () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => {
          if (failNextInsert) return Promise.reject(new Error("db down"))
          insertCalls.push({ values })
          return Promise.resolve()
        },
      }),
    }),
  },
  aiUsageEvents: { requestId: "request_id" },
}))

const { recordAiUsage, sanitizeTelemetryMetadata } = await import("./ai-telemetry.js")

beforeEach(() => {
  insertCalls.length = 0
  failNextInsert = false
})

describe("sanitizeTelemetryMetadata", () => {
  it("strips content-shaped keys", () => {
    const out = sanitizeTelemetryMetadata({
      prompt: "secret prompt",
      messages: [],
      content: "hi",
      text: "hi",
      transcript: "hi",
      screenshot: "b64",
      image: "b64",
      audio: "b64",
      payload: {},
      latencyMs: 120,
      toolCalls: 3,
    })
    expect(out).toEqual({ latencyMs: 120, toolCalls: 3 })
  })

  it("returns null for empty/undefined input", () => {
    expect(sanitizeTelemetryMetadata(undefined)).toBeNull()
    expect(sanitizeTelemetryMetadata({})).toBeNull()
    expect(sanitizeTelemetryMetadata({ prompt: "x" })).toBeNull()
  })
})

describe("recordAiUsage", () => {
  it("inserts a completed row with sanitized metadata and clamped ints", async () => {
    await recordAiUsage({
      userId: "u1",
      requestId: "req-1",
      endpoint: "sidecar.fast",
      surface: "desktop",
      route: "fast",
      model: "gpt-5.5-mini",
      inputTokens: 120.9,
      outputTokens: -5,
      latencyMs: 900,
      status: "done",
      metadata: { prompt: "never store me", latencyMs: 900 },
    })
    expect(insertCalls.length).toBe(1)
    const v = insertCalls[0]!.values
    expect(v["requestId"]).toBe("req-1")
    expect(v["inputTokens"]).toBe(120)
    expect(v["outputTokens"]).toBe(0)
    expect(v["status"]).toBe("done")
    expect((v["metadata"] as Record<string, unknown>)["prompt"]).toBeUndefined()
    expect(v["completedAt"]).toBeInstanceOf(Date)
  })

  it("never throws when the insert fails", async () => {
    failNextInsert = true
    await expect(
      recordAiUsage({
        userId: "u1",
        requestId: "req-2",
        endpoint: "backend.agent",
        surface: "telegram",
        status: "done",
      }),
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && bun test src/services/ai-telemetry.test.ts`
Expected: FAIL — `Cannot find module './ai-telemetry.js'`

- [ ] **Step 3: Write `apps/backend/src/services/ai-telemetry.ts`**

```ts
import { db, aiUsageEvents } from "@yomi/db"

// Content-shaped keys that must never reach telemetry storage (spec 22
// non-goal: no raw prompt content beyond existing message/session tables).
const BLOCKED_METADATA_KEYS = new Set([
  "prompt",
  "messages",
  "content",
  "text",
  "transcript",
  "screenshot",
  "screenshots",
  "image",
  "images",
  "audio",
  "payload",
  "body",
])

export type AiUsageRecord = {
  userId: string
  requestId: string
  endpoint: string
  surface: string
  status: "done" | "error" | "cancelled"
  usageEventId?: string | null
  route?: string | null
  intent?: string | null
  complexity?: string | null
  model?: string | null
  provider?: string | null
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
  embeddingTokens?: number
  maxOutputTokens?: number
  toolCalls?: number
  connectorIds?: string[]
  visionImages?: number
  voiceDurationSeconds?: number
  ttsChars?: number
  sttAudioSeconds?: number
  latencyMs?: number
  firstTokenLatencyMs?: number | null
  totalApiCostMicros?: number
  creditsEstimated?: number
  creditsCharged?: number
  errorCode?: string | null
  metadata?: Record<string, unknown>
}

export function sanitizeTelemetryMetadata(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!meta) return null
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (BLOCKED_METADATA_KEYS.has(key.toLowerCase())) continue
    out[key] = value
  }
  return Object.keys(out).length ? out : null
}

function clamp(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

// One-shot insert of a completed telemetry event. Idempotent on requestId
// (unique index + onConflictDoNothing). Best-effort: telemetry must never
// break a request path.
export async function recordAiUsage(input: AiUsageRecord): Promise<void> {
  try {
    await db
      .insert(aiUsageEvents)
      .values({
        userId: input.userId,
        requestId: input.requestId,
        usageEventId: input.usageEventId ?? null,
        endpoint: input.endpoint,
        surface: input.surface,
        route: input.route ?? null,
        intent: input.intent ?? null,
        complexity: input.complexity ?? null,
        model: input.model ?? null,
        provider: input.provider ?? "ai-credits",
        inputTokens: clamp(input.inputTokens),
        outputTokens: clamp(input.outputTokens),
        reasoningTokens: clamp(input.reasoningTokens),
        cachedInputTokens: clamp(input.cachedInputTokens),
        embeddingTokens: clamp(input.embeddingTokens),
        maxOutputTokens: clamp(input.maxOutputTokens),
        toolCalls: clamp(input.toolCalls),
        connectorCount: input.connectorIds?.length ?? 0,
        connectorIds: input.connectorIds ?? [],
        visionImages: clamp(input.visionImages),
        voiceDurationSeconds: clamp(input.voiceDurationSeconds),
        ttsChars: clamp(input.ttsChars),
        sttAudioSeconds: clamp(input.sttAudioSeconds),
        latencyMs: clamp(input.latencyMs),
        firstTokenLatencyMs:
          typeof input.firstTokenLatencyMs === "number"
            ? Math.max(0, Math.floor(input.firstTokenLatencyMs))
            : null,
        totalApiCostMicros: clamp(input.totalApiCostMicros),
        creditsEstimated: clamp(input.creditsEstimated),
        creditsCharged: clamp(input.creditsCharged),
        status: input.status,
        errorCode: input.errorCode ?? null,
        metadata: sanitizeTelemetryMetadata(input.metadata),
        completedAt: new Date(),
      })
      .onConflictDoNothing({ target: aiUsageEvents.requestId })
  } catch (err) {
    console.warn(
      "[ai-telemetry] recordAiUsage failed:",
      err instanceof Error ? err.message : String(err),
    )
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && bun test src/services/ai-telemetry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit** (executor per repo convention — opencode)

```bash
git add apps/backend/src/services/ai-telemetry.ts apps/backend/src/services/ai-telemetry.test.ts
git commit -m "feat: add ai-telemetry service with metadata sanitization"
```

---

### Task 3: Finalize endpoint writes `ai_usage_events`

**Files:**
- Modify: `apps/backend/src/routes/usage.ts` (the `/interactions/finalize` handler, lines 98–124)
- Test: `apps/backend/src/routes/usage.test.ts` (add cases; extend existing mocks)

**Interfaces:**
- Consumes: `recordAiUsage` from Task 2.
- Produces: `FinalizeBody` gains an optional `telemetry` block. Old sidecars that omit it keep working unchanged (backward compat requirement).

- [ ] **Step 1: Extend the existing mock setup and add failing tests in `usage.test.ts`**

Add near the other `mock.module` calls (before the dynamic import):

```ts
const recordedTelemetry: Array<Record<string, unknown>> = []
mock.module("../services/ai-telemetry.js", () => ({
  recordAiUsage: async (input: Record<string, unknown>) => {
    recordedTelemetry.push(input)
  },
}))
```

Add a `beforeEach` reset (`recordedTelemetry.length = 0`) and these tests at the end of the file:

```ts
describe("POST /interactions/finalize telemetry", () => {
  it("records ai usage when a telemetry block is present", async () => {
    const res = await request("/interactions/finalize", {
      method: "POST",
      body: JSON.stringify({
        usageEventId: "usage_1",
        model: "gpt-5.5-mini",
        inputTokens: 100,
        outputTokens: 50,
        status: "done",
        metadata: { endpoint: "sidecar.fast", route: "fast", latencyMs: 900 },
        telemetry: {
          requestId: "req-abc",
          endpoint: "sidecar.fast",
          surface: "desktop",
          firstTokenLatencyMs: 220,
          toolCalls: 0,
        },
      }),
    })
    expect(res.status).toBe(200)
    expect(recordedTelemetry.length).toBe(1)
    expect(recordedTelemetry[0]!["requestId"]).toBe("req-abc")
    expect(recordedTelemetry[0]!["usageEventId"]).toBe("usage_1")
    expect(recordedTelemetry[0]!["inputTokens"]).toBe(100)
  })

  it("still succeeds with no telemetry block (backward compat)", async () => {
    const res = await request("/interactions/finalize", {
      method: "POST",
      body: JSON.stringify({ usageEventId: "usage_1", inputTokens: 10 }),
    })
    expect(res.status).toBe(200)
    expect(recordedTelemetry.length).toBe(0)
  })
})
```

(Reuse the file's existing `request()`/app-wiring helper; if it drives the router directly with `usageRouter.request(...)`, follow that same pattern.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `cd apps/backend && bun test src/routes/usage.test.ts`
Expected: new tests FAIL (telemetry never recorded); pre-existing tests PASS.

- [ ] **Step 3: Implement in `usage.ts`**

Extend `FinalizeBody`:

```ts
type FinalizeTelemetryBody = {
  requestId?: string
  endpoint?: string
  surface?: string
  route?: string
  intent?: string
  firstTokenLatencyMs?: number
  latencyMs?: number
  toolCalls?: number
  connectorIds?: string[]
  visionImages?: number
  ttsChars?: number
  sttAudioSeconds?: number
  maxOutputTokens?: number
}

type FinalizeBody = {
  usageEventId?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  costCents?: number
  status?: "done" | "error" | "cancelled"
  metadata?: Record<string, unknown>
  telemetry?: FinalizeTelemetryBody
}
```

Add the import at the top: `import { recordAiUsage } from "../services/ai-telemetry.js"`.

At the end of the `/interactions/finalize` handler, after the existing `db.update(usageEvents)` and before `return c.json({ ok: true })`:

```ts
  const t = body.telemetry
  if (t?.requestId && t.endpoint && t.surface) {
    await recordAiUsage({
      userId: user.id,
      requestId: t.requestId,
      usageEventId,
      endpoint: t.endpoint,
      surface: t.surface,
      route: t.route ?? null,
      intent: t.intent ?? null,
      model: body.model ?? null,
      inputTokens,
      outputTokens,
      totalApiCostMicros: costCents * 10_000,
      toolCalls: t.toolCalls,
      connectorIds: t.connectorIds,
      visionImages: t.visionImages,
      ttsChars: t.ttsChars,
      sttAudioSeconds: t.sttAudioSeconds,
      maxOutputTokens: t.maxOutputTokens,
      latencyMs: t.latencyMs,
      firstTokenLatencyMs: t.firstTokenLatencyMs ?? null,
      status: body.status === "error" ? "error" : body.status === "cancelled" ? "cancelled" : "done",
      metadata: body.metadata,
    })
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && bun test src/routes/usage.test.ts`
Expected: PASS, including all pre-existing cases.

- [ ] **Step 5: Commit** (executor per repo convention — opencode)

```bash
git add apps/backend/src/routes/usage.ts apps/backend/src/routes/usage.test.ts
git commit -m "feat: accept telemetry block on usage finalize endpoint"
```

---

### Task 4: Sidecar sends the telemetry block (fast + agent)

**Files:**
- Modify: `apps/sidecar/src/usage/reserve.ts` (extend `FinalizeUsageInput`)
- Modify: `apps/sidecar/src/pipeline/fast.ts` (lines ~493–541)
- Modify: `apps/sidecar/src/pipeline/agent.ts` (the three `finalizeInteractionUsage` call sites at ~415, ~441, ~495)

**Interfaces:**
- Consumes: Task 3's `telemetry` block contract.
- Produces: every sidecar finalize now carries `telemetry.requestId` (a fresh `crypto.randomUUID()` per pipeline run), `endpoint`, `surface: "desktop"`, `route`, `latencyMs`, `firstTokenLatencyMs` (fast path), `toolCalls` (agent path), `visionImages`.

- [ ] **Step 1: Extend `FinalizeUsageInput` in `reserve.ts`**

```ts
export type FinalizeTelemetry = {
  requestId: string
  endpoint: string
  surface: string
  route?: string
  latencyMs?: number
  firstTokenLatencyMs?: number
  toolCalls?: number
  connectorIds?: string[]
  visionImages?: number
  maxOutputTokens?: number
}

export type FinalizeUsageInput = {
  usageEventId?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  costCents?: number
  status?: "done" | "error" | "cancelled" | "budget_exhausted"
  metadata?: Record<string, unknown>
  telemetry?: FinalizeTelemetry
}
```

(No change needed to `finalizeInteractionUsage` itself — it already `JSON.stringify(input)`s the whole object.)

- [ ] **Step 2: Wire the fast path in `fast.ts`**

Inside `fastPipeline`, right before the `try` block at line 492, add:

```ts
  const requestId = crypto.randomUUID()
  let firstTokenAt: number | null = null
```

In the event loop (line 507-510), record first-token time:

```ts
      if (event.type === "llm_chunk") {
        if (firstTokenAt === null) firstTokenAt = Date.now()
        output += event.text
      }
```

Extend the success-path `finalizeInteractionUsage` call (line 518) with:

```ts
      telemetry: {
        requestId,
        endpoint: "sidecar.fast",
        surface: "desktop",
        route: "fast",
        latencyMs: Date.now() - startedAt,
        firstTokenLatencyMs: firstTokenAt === null ? undefined : firstTokenAt - startedAt,
        visionImages: (req.screenshots?.length ?? 0) + (req.screenshot_b64 ? 1 : 0),
      },
```

Extend the error-path call (line 535) with:

```ts
      telemetry: {
        requestId,
        endpoint: "sidecar.fast",
        surface: "desktop",
        route: "fast",
      },
```

- [ ] **Step 3: Wire the agent path in `agent.ts`**

Add near the existing `startedAt` declaration: `const requestId = crypto.randomUUID()`.

Extend all three `finalizeInteractionUsage` calls (billing-error ~415, generic-error ~441, success ~495) with the same shape:

```ts
      telemetry: {
        requestId,
        endpoint: "sidecar.agent",
        surface: "desktop",
        route: "agent",
        latencyMs: Date.now() - startedAt,
        toolCalls,
        visionImages: req.screenshot_b64 ? 1 : 0,
      },
```

Note: `status: "budget_exhausted"` maps to `"done"` server-side (Task 3's status mapping) — the budget flag remains visible in `metadata`.

- [ ] **Step 4: Verify sidecar tests and typecheck**

Run: `cd apps/sidecar && bun run typecheck && bun test`
Expected: PASS — existing e2e mocks stub `finalizeInteractionUsage`, so they're unaffected.

- [ ] **Step 5: Commit** (executor per repo convention — opencode)

```bash
git add apps/sidecar/src/usage/reserve.ts apps/sidecar/src/pipeline/fast.ts apps/sidecar/src/pipeline/agent.ts
git commit -m "feat: send telemetry block from sidecar pipelines"
```

---

### Task 5: Telegram agent telemetry (`agent/run.ts`)

**Files:**
- Modify: `apps/backend/src/agent/run.ts` (the `onUsage` callback, lines 526–541)
- Test: `apps/backend/src/agent/run.test.ts` (add mock + assertion)

**Interfaces:**
- Consumes: `recordAiUsage` from Task 2.
- Produces: every Telegram agent turn writes an `ai_usage_events` row with `endpoint: "backend.agent"`, `surface: "telegram"`, linked to the `bot_message` usage event.

- [ ] **Step 1: Add the mock + failing assertion in `run.test.ts`**

Follow the file's existing `mock.module` pattern; add:

```ts
const recordedTelemetry: Array<Record<string, unknown>> = []
mock.module("../services/ai-telemetry.js", () => ({
  recordAiUsage: async (input: Record<string, unknown>) => {
    recordedTelemetry.push(input)
  },
}))
```

In an existing happy-path test that drives `runAgent` through a mocked `runAgentLoop` that invokes `onUsage`, assert afterwards:

```ts
    expect(recordedTelemetry.length).toBe(1)
    expect(recordedTelemetry[0]!["endpoint"]).toBe("backend.agent")
    expect(recordedTelemetry[0]!["surface"]).toBe("telegram")
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && bun test src/agent/run.test.ts`
Expected: new assertion FAILS.

- [ ] **Step 3: Implement in `run.ts`**

Import: `import { recordAiUsage } from "../services/ai-telemetry.js"`.

Add `const startedAt = Date.now()` just before the `runAgentLoop` call (line ~512), and extend the `onUsage` callback body (after the existing `db.update(usageEvents)` chain):

```ts
            recordAiUsage({
              userId: opts.userId,
              requestId: crypto.randomUUID(),
              usageEventId,
              endpoint: "backend.agent",
              surface: "telegram",
              route: "agent",
              model: usage.model,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              latencyMs: Date.now() - startedAt,
              status: "done",
            }).catch(() => {})
```

Also make the callback unconditional (currently gated on `usageEventId`): change the ternary so that when `usageEventId` is undefined the callback still runs `recordAiUsage` (with `usageEventId: null`) and skips only the `db.update(usageEvents)` part.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && bun test src/agent/run.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (executor per repo convention — opencode)

```bash
git add apps/backend/src/agent/run.ts apps/backend/src/agent/run.test.ts
git commit -m "feat: record ai telemetry for telegram agent runs"
```

---

### Task 6: Gateway image + voice telemetry

**Files:**
- Modify: `apps/backend/src/gateway/gateway-runner.ts` (`analyzeImage` ~line 353; voice input ~line 953; voice reply ~line 448)
- Test: `apps/backend/src/gateway/gateway-runner.test.ts` (mock `ai-telemetry`, assert on image path)

**Interfaces:**
- Consumes: `recordAiUsage` from Task 2.
- Produces: `endpoint: "gateway.image"` events with real token usage and `visionImages: 1`; `endpoint: "gateway.voice"` events with `sttAudioSeconds`/`ttsChars`.

- [ ] **Step 1: Add mock + failing test in `gateway-runner.test.ts`**

Same `mock.module("../services/ai-telemetry.js", ...)` recorder pattern as Tasks 3/5. In the existing image-message test, assert `recordedTelemetry` contains one entry with `endpoint: "gateway.image"` and `visionImages: 1`.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && bun test src/gateway/gateway-runner.test.ts`
Expected: new assertion FAILS.

- [ ] **Step 3: Implement**

Import `recordAiUsage`. In `analyzeImage`, capture usage from the `generateText` result (line 363 — the AI SDK result exposes `usage.promptTokens` / `usage.completionTokens`):

```ts
    const startedAt = Date.now()
    const result = await generateText({ /* existing args unchanged */ })
    recordAiUsage({
      userId: /* the yomi user id already in scope at the call site — pass it into analyzeImage as a param */,
      requestId: crypto.randomUUID(),
      endpoint: "gateway.image",
      surface: "telegram",
      route: "gateway",
      model: process.env["AI_CREDITS_AGENT_MODEL"] || "gpt-5.5",
      inputTokens: result.usage?.promptTokens,
      outputTokens: result.usage?.completionTokens,
      visionImages: 1,
      latencyMs: Date.now() - startedAt,
      status: "done",
    }).catch(() => {})
```

`analyzeImage(msg, history)` currently doesn't receive the user ID — change its signature to `analyzeImage(msg, history, yomiUserId: string)` and update the single call site at line 1098.

For voice: in the voice-input branch (~line 953, next to `recordGatewayCreditAddon`), add:

```ts
          recordAiUsage({
            userId: yomiUserId,
            requestId: crypto.randomUUID(),
            endpoint: "gateway.voice",
            surface: "telegram",
            route: "gateway",
            sttAudioSeconds: msg.audioDurationSeconds ?? 0,
            status: "done",
          }).catch(() => {})
```

And in `sendVoiceReplyIfRequested` (~line 448, inside `if (result.ok)`):

```ts
        recordAiUsage({
          userId: yomiUserId,
          requestId: crypto.randomUUID(),
          endpoint: "gateway.voice",
          surface: "telegram",
          route: "gateway",
          ttsChars: spokenText.length,
          status: "done",
        }).catch(() => {})
```

- [ ] **Step 4: Run the full backend suite**

Run: `cd apps/backend && bun test`
Expected: PASS.

- [ ] **Step 5: Full CI gate, then commit** (executor per repo convention — opencode)

Run: `bun run ci` (repo root) — must be green before push per AGENTS.md.

```bash
git add apps/backend/src/gateway/gateway-runner.ts apps/backend/src/gateway/gateway-runner.test.ts
git commit -m "feat: record gateway image and voice telemetry"
```

---

## Self-review checklist (done at plan time)

- Spec Phase-1 coverage: schema ✅, migration+indexes ✅, telemetry service ✅, idempotency (unique request_id + onConflictDoNothing) ✅, no-raw-prompt tests ✅, provider wrappers — covered via existing AI SDK usage propagation + finalize path instead of `model.ts` hooks (deliberate deviation: usage already flows through `doGenerate`/`doStream` results; documented in Prior-state notes). Embeddings/llm-proxy/compressor/cron explicitly deferred (Out of scope section).
- Acceptance: sidecar fast path (Task 4) writes a complete row per request; credits unchanged everywhere.
- Type consistency: `AiUsageRecord`/`FinalizeTelemetry`/`FinalizeTelemetryBody` field names match across Tasks 2/3/4.
