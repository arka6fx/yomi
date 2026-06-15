# Telegram Reliability & Bot Message Metering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix intermittent silent failures when Telegram messages arrive with the desktop offline, and correctly meter bot messages against the `botMessages` plan limit with proper credit deduction instead of the current orphaned `gateway_message` quota bucket.

**Architecture:** Two independent, non-overlapping changes. (1) `GatewayRunner.onIncoming` gets a 4-second abort signal on the sidecar fetch and a top-level try/catch so any unhandled error sends a reply instead of silently dropping the message. (2) `runAgent()` switches from a manual `gateway_message`/`chat`-limit check to the established reserve pattern: count `bot_message` events against `botMessages` plan limit, check Explore users' credit balance, deduct 1 credit per call, and log the usage event after the LLM call completes.

**Tech Stack:** Bun, TypeScript, Drizzle ORM, `bun:test`, `@yomi/db` (usageEvents), `@yomi/agent-core` (runAgentLoop), `../services/credit-ledger` (consumeCredits, getCreditSummary)

---

## Files

| File | Action | Responsibility |
|---|---|---|
| `apps/backend/src/gateway/gateway-runner.ts` | Modify | Add 4-second abort to sidecar fetch; top-level try/catch in `onIncoming` |
| `apps/backend/src/agent/run.ts` | Modify | Correct quota kind, credit check, credit deduction, post-call event logging |
| `apps/backend/src/agent/run.test.ts` | Create | Unit tests for runAgent metering behaviour |

---

## Task 1: Sidecar Fetch Timeout

**Files:**
- Modify: `apps/backend/src/gateway/gateway-runner.ts`

- [ ] **Step 1: Add `AbortSignal.timeout(4_000)` to the sidecar fetch**

Locate the sidecar forward block in `onIncoming` (around line 619). The current `fetch` call has no timeout. Replace:

```ts
const res = await fetch(`${sidecarUrl}/gateway/receive`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${this.sidecarSecret}`,
  },
  body: JSON.stringify({ ...msg, yomiUserId }),
})
```

With:

```ts
const res = await fetch(`${sidecarUrl}/gateway/receive`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${this.sidecarSecret}`,
  },
  body: JSON.stringify({ ...msg, yomiUserId }),
  signal: AbortSignal.timeout(4_000),
})
```

`AbortSignal.timeout` is natively available in Bun. The thrown `AbortError` is caught by the existing `catch` block and falls through to `runAgent()`.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/backend && bun run build 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/gateway/gateway-runner.ts
git commit -m "fix: add 4s timeout to sidecar forward fetch so offline desktop fails fast"
```

---

## Task 2: Top-Level Safety Catch in `onIncoming`

**Files:**
- Modify: `apps/backend/src/gateway/gateway-runner.ts`

- [ ] **Step 1: Wrap the entire `onIncoming` body**

`onIncoming` is called with `void this.onIncoming(msg)` — any throw silently drops the message. The fix is a single try/catch around the whole body.

Find the `private async onIncoming(msg: GatewayMessage): Promise<void> {` declaration. Wrap all existing content:

```ts
private async onIncoming(msg: GatewayMessage): Promise<void> {
  try {
    // ── all existing content goes here, indentation unchanged ──
  } catch (err) {
    console.warn("[gateway] onIncoming uncaught error:", err)
    try {
      await this.sendMessage(
        msg.platform,
        msg.chatId,
        "Sorry, something went wrong. Please try again.",
      )
    } catch { /* ignore — best-effort */ }
  }
}
```

Do not change anything inside the try block. The existing internal try/catches (transcription, runAgent, etc.) still handle their own errors; this is purely a backstop.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/backend && bun run build 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/gateway/gateway-runner.ts
git commit -m "fix: wrap onIncoming in top-level try/catch to prevent silent message drops"
```

---

## Task 3: Write Failing Tests for `runAgent()` Metering

**Files:**
- Create: `apps/backend/src/agent/run.test.ts`

These tests verify the new behaviour before we implement it. They MUST fail with the current code.

- [ ] **Step 1: Create the test file**

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test"

// ── mocks ──────────────────────────────────────────────────────────────────

let mockUser: Record<string, unknown> | null = null
let mockBotMessageCount = 0
let mockCreditBalance = 100
let lastInsertedKind: string | null = null
let consumeCreditsCalled = false

const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(mockUser ? [mockUser] : []),
      }),
    }),
  }),
  insert: () => ({
    values: (v: Record<string, unknown>) => {
      lastInsertedKind = v["kind"] as string
      return {
        catch: () => Promise.resolve([{ id: "evt_1" }]),
        returning: () => ({
          catch: () => Promise.resolve([{ id: "evt_1" }]),
        }),
      }
    },
  }),
  execute: () => Promise.resolve({ rows: [] }),
}

// count(*) for botMessages quota check returns mockBotMessageCount
const fakeDbWithCount = {
  ...fakeDb,
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(mockUser ? [mockUser] : []),
        then: (fn: (r: unknown[]) => unknown) => fn(mockUser ? [mockUser] : []),
      }),
      then: (fn: (r: unknown[]) => unknown) =>
        fn([{ count: mockBotMessageCount }]),
    }),
  }),
}

mock.module("@yomi/db", () => ({
  db: fakeDbWithCount,
  usageEvents: {},
  ragChunks: {},
  ragDocuments: {},
  ragSources: {},
}))

mock.module("@yomi/agent-core", () => ({
  ConnectorRegistry: class {
    async init() {}
  },
  runAgentLoop: async () => "The answer is 42.",
}))

mock.module("../services/integration-tokens.js", () => ({
  getAccessToken: async () => "tok",
  listConnectedProviders: async () => [],
}))

mock.module("../services/credit-ledger.js", () => ({
  getCreditSummary: async () => ({
    balance: mockCreditBalance,
    lifetimeGranted: 0,
    lifetimeConsumed: 0,
    lifetimeRefunded: 0,
    expiringSoon: 0,
    expiringSoonAt: null,
  }),
  consumeCredits: async () => {
    consumeCreditsCalled = true
    return { ok: true, charged: 1, balance: mockCreditBalance - 1 }
  },
}))

mock.module("../auth-schema.js", () => ({ user: {} }))

// ── helpers ────────────────────────────────────────────────────────────────

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user_1",
    email: "test@example.com",
    role: "user",
    plan: "explore",
    subscriptionStatus: "active",
    currentPeriodEnd: null,
    ...overrides,
  }
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("runAgent metering", () => {
  beforeEach(() => {
    mockUser = makeUser()
    mockBotMessageCount = 0
    mockCreditBalance = 100
    lastInsertedKind = null
    consumeCreditsCalled = false
  })

  it("returns error when user not found", async () => {
    mockUser = null
    const { runAgent } = await import("./run.js")
    const result = await runAgent({ userId: "ghost", text: "hi" })
    expect(result.text).toInclude("couldn't find your account")
  })

  it("blocks inactive subscription (non-explore, non-active)", async () => {
    mockUser = makeUser({ plan: "pro", subscriptionStatus: "canceled" })
    const { runAgent } = await import("./run.js")
    const result = await runAgent({ userId: "user_1", text: "hi" })
    expect(result.quotaError).toBe(true)
    expect(result.text).toInclude("inactive")
  })

  it("blocks when botMessages monthly limit is reached", async () => {
    // Explore plan has botMessages limit of 20
    mockUser = makeUser({ plan: "explore", subscriptionStatus: "active" })
    mockBotMessageCount = 20   // at the limit
    const { runAgent } = await import("./run.js")
    const result = await runAgent({ userId: "user_1", text: "hi" })
    expect(result.quotaError).toBe(true)
    expect(result.text).toInclude("bot messages")
  })

  it("blocks explore user with 0 credits", async () => {
    mockUser = makeUser({ plan: "explore", subscriptionStatus: "active" })
    mockCreditBalance = 0
    const { runAgent } = await import("./run.js")
    const result = await runAgent({ userId: "user_1", text: "hi" })
    expect(result.quotaError).toBe(true)
  })

  it("logs a bot_message event (not gateway_message) on success", async () => {
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(lastInsertedKind).toBe("bot_message")
  })

  it("calls consumeCredits after a successful run", async () => {
    mockUser = makeUser()
    const { runAgent } = await import("./run.js")
    await runAgent({ userId: "user_1", text: "hi" })
    expect(consumeCreditsCalled).toBe(true)
  })

  it("owner user bypasses all quota and credit checks", async () => {
    mockUser = makeUser({ role: "owner", plan: "explore", subscriptionStatus: null })
    mockBotMessageCount = 9999
    mockCreditBalance = 0
    const { runAgent } = await import("./run.js")
    const result = await runAgent({ userId: "user_1", text: "hi" })
    expect(result.quotaError).toBeUndefined()
    expect(result.text).toBe("The answer is 42.")
    expect(consumeCreditsCalled).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — confirm they FAIL**

```bash
cd apps/backend && bun test src/agent/run.test.ts 2>&1
```

Expected: failures on `bot_message` kind, `botMessages` limit, and `consumeCredits` assertions (current code uses `gateway_message` and `requestLimitForUser`).

---

## Task 4: Fix `runAgent()` to Pass the Tests

**Files:**
- Modify: `apps/backend/src/agent/run.ts`

- [ ] **Step 1: Update imports**

Replace the current import block at the top of `run.ts`:

```ts
import { eq, and, gte, sql } from "drizzle-orm"
import { db, usageEvents, ragChunks, ragDocuments, ragSources } from "@yomi/db"
import { ConnectorRegistry, runAgentLoop, type AgentMessage } from "@yomi/agent-core"
import {
  getAccessToken,
  listConnectedProviders,
} from "../services/integration-tokens.js"
import {
  hasBillablePlanAccess,
  featureLimitForUser,
  isOwnerUser,
  effectivePlanForUser,
} from "../entitlements.js"
import { getCreditSummary, consumeCredits } from "../services/credit-ledger.js"
import * as authSchema from "../auth-schema.js"
```

(Removed `requestLimitForUser` — no longer used. Added `effectivePlanForUser`, `getCreditSummary`, `consumeCredits`.)

- [ ] **Step 2: Replace `runAgent()` body**

Replace the full `runAgent` function (everything from `export async function runAgent` through its closing `}`):

```ts
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const user = await fetchUser(opts.userId)
  if (!user) {
    return { text: "I couldn't find your account. Please re-link your account.", quotaError: false }
  }

  // Subscription access (7-day grace for past_due is inside hasBillablePlanAccess)
  if (!hasBillablePlanAccess(user)) {
    const status = user.subscriptionStatus ?? "inactive"
    const msg =
      status === "past_due"
        ? "Your payment is past due. Update your payment method to restore full access."
        : "Your subscription is inactive. Visit the dashboard to manage your plan."
    return { text: msg, quotaError: true }
  }

  // Bot message monthly limit — uses the botMessages plan limit, not chat
  if (!isOwnerUser(user)) {
    const limit = featureLimitForUser(user, "botMessages")
    if (limit !== null) {
      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.userId, opts.userId),
            eq(usageEvents.kind, "bot_message"),
            gte(usageEvents.createdAt, currentMonthStart()),
          ),
        )
      const used = Number(countRow?.count ?? 0)
      if (used >= limit) {
        return {
          text: `You've used ${used} of ${limit} bot messages this month. Upgrade your plan to continue.`,
          quotaError: true,
        }
      }
    }
  }

  // Credit balance check for Explore users (1 credit per bot message)
  const creditsRequired = 1
  if (!isOwnerUser(user) && effectivePlanForUser(user) === "explore") {
    const summary = await getCreditSummary(opts.userId)
    if (summary.balance < creditsRequired) {
      return {
        text: "Free credits used up for this month. Upgrade your plan for more.",
        quotaError: true,
      }
    }
  }

  // Connector limit based on plan
  const connectorLimit = isOwnerUser(user) ? Infinity : (featureLimitForUser(user, "connectors") ?? Infinity)

  const registry = new ConnectorRegistry({
    getAccessToken,
    listConnectedProviders: async (userId: string) => {
      const all = await listConnectedProviders(userId)
      return Number.isFinite(connectorLimit) ? all.slice(0, connectorLimit) : all
    },
  })
  await registry.init(opts.userId)

  const appUrl = process.env["YOMI_APP_URL"] ?? "https://yomi.arka6fx.com"
  const ragContext = await fetchRagContext(opts.userId, opts.text)

  let text: string
  try {
    text = await runAgentLoop({
      registry,
      text: opts.text,
      history: opts.history,
      system: buildSystemWithContext(ragContext),
      signal: opts.signal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[runAgent] loop error:", msg)

    if (/\b(401|403|unauthorized|forbidden|revoked|invalid.*token|token.*invalid)\b/i.test(msg)) {
      text =
        `Authorization error: ${msg.slice(0, 300)}\n\n` +
        `Your integration token may have expired or been revoked. ` +
        `Please reconnect at ${appUrl}/dashboard.`
    } else if (/\b(429|rate.limit|too many requests)\b/i.test(msg)) {
      text = "Rate limit hit — please wait a moment and try again."
    } else if (/\b(timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|network)\b/i.test(msg)) {
      text = "Network error — couldn't reach a required service. Please try again."
    } else {
      text =
        `Something went wrong: ${msg.slice(0, 300)}\n\nPlease try again, or ` +
        `check your integrations at ${appUrl}/dashboard if this keeps happening.`
    }
  }

  // Log usage event AFTER the LLM call. runAgentLoop doesn't return token counts
  // so inputTokens/outputTokens remain 0 until agent-core exposes them.
  const [event] = await db
    .insert(usageEvents)
    .values({
      userId: opts.userId,
      kind: "bot_message",
      model: process.env["AI_CREDITS_AGENT_MODEL"] ?? "gpt-4.1",
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      creditsCharged: 0,
      status: "done",
    })
    .returning({ id: usageEvents.id })
    .catch(() => [] as { id: string }[])

  // Deduct credits (non-owners only; Explore users already had balance checked above)
  if (!isOwnerUser(user) && event?.[0]?.id) {
    await consumeCredits({
      userId: opts.userId,
      amount: creditsRequired,
      usageEventId: event[0].id,
      idempotencyKey: `gateway:${event[0].id}:consume`,
      reason: "bot message",
      metadata: { kind: "bot_message" },
    }).catch(() => { /* best-effort */ })
  }

  return { text }
}
```

- [ ] **Step 3: Run tests — confirm they pass**

```bash
cd apps/backend && bun test src/agent/run.test.ts 2>&1
```

Expected: all 7 tests PASS.

- [ ] **Step 4: Run the full backend test suite**

```bash
cd apps/backend && bun test 2>&1
```

Expected: all tests pass (no regressions).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/agent/run.ts apps/backend/src/agent/run.test.ts
git commit -m "fix: meter gateway bot messages against botMessages limit with credit deduction"
```

---

## Task 5: Update Dashboard to Include `bot_message` in Usage Display

**Files:**
- Modify: `apps/backend/src/routes/billing.ts`

The `/api/billing/subscription` endpoint currently shows `agentUsed` mapped from `agent_run` events but labels it `botMessages`. It does not count `bot_message` events at all. Fix the count so the dashboard is accurate.

- [ ] **Step 1: Fix the kind list in the billing subscription query**

In `billing.ts`, find the `kindCounts` query (around line 574). The `inArray` currently includes `"agent_run"`. Add `"bot_message"` to the list:

```ts
inArray(usageEvents.kind, [
  "request_chat",
  "request_voice",
  "stt",
  "agent_run",
  "screenshot",
  "reasoning",
  "bot_message",
]),
```

- [ ] **Step 2: Use the `bot_message` count for `botMessages` display**

Find the `agentUsed` line (around line 595):

```ts
const agentUsed = countMap["agent_run"] ?? 0
```

Replace with:

```ts
const agentUsed = (countMap["agent_run"] ?? 0) + (countMap["bot_message"] ?? 0)
```

This combines sidecar agent runs (when desktop is on) with direct backend bot messages (when desktop is off) into a single `botMessages` display.

- [ ] **Step 3: Run billing tests**

```bash
cd apps/backend && bun test src/routes/billing.test.ts 2>&1
```

Expected: all existing billing tests pass (no test covers this count, so no new test needed — the billing query is integration-level and tested via E2E).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/routes/billing.ts
git commit -m "fix: include bot_message events in dashboard botMessages usage count"
```

---

## Self-Review

**Spec coverage:**
- ✅ Sidecar fetch timeout (Task 1)
- ✅ Top-level try/catch in `onIncoming` (Task 2)
- ✅ `botMessages` limit enforced (Task 4, quota check)
- ✅ Credit deduction (Task 4, `consumeCredits` call)
- ✅ `bot_message` kind (not `gateway_message`) (Task 4, event insert)
- ✅ Dashboard shows bot message usage (Task 5)
- ⚠️ Token count logging — `runAgentLoop` doesn't return token counts; logged as 0. Noted in code comment. Fixing requires a separate change to `@yomi/agent-core` out of scope here.

**Placeholder scan:** None found.

**Type consistency:**
- `featureLimitForUser(user, "botMessages")` — `"botMessages"` is a valid `FeatureKey` per `plans.ts` (`limits: { botMessages: number }`). ✅
- `consumeCredits` signature matches `credit-ledger.ts` export. ✅
- `event?.[0]?.id` — `returning({ id: usageEvents.id })` returns `{ id: string }[]`. ✅
