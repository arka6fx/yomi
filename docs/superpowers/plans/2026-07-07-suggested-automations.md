# Suggested Automations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer one-tap starter automations per connected integration; accepting creates a real schedule through the existing engine, dismissing latches forever.

**Architecture:** Suggestions are computed, never stored: a static catalog × the user's connected integrations × prerequisites, minus rows in a new `suggestion_decisions` latch table. Accept reuses the schedules engine's exact parsing/limit logic via a small extracted quota helper. Desktop surfaces cards on the Integrations page through the established IPC bridge.

**Tech Stack:** TypeScript, Hono on Cloudflare Workers, Drizzle + Neon (`db` from `@yomi/db`, HTTP mode), `bun:test`, Electron desktop (renderer → preload → main IPC).

## Global Constraints

- Runtime: Cloudflare Workers — use existing `db` from `@yomi/db`; never `Pool`; no module-scope mutable non-plain-data state; env reads lazy inside functions.
- **Connector provider ids** (must match `mcp_connections.provider`): Gmail = `"google"`, Calendar = `"google-calendar"`, Drive = `"google-drive"`, GitHub = `"github"`.
- Telegram linkage check = a `platform_connections` row with `platform = 'telegram'` for the user.
- Accept must enforce the SAME plan gate as `POST /api/schedules` (403 `feature_not_available` when limit ≤ 0, 402 `schedule_limit` when at cap; owner bypasses) — via the shared helper extracted in Task 3, not a copy.
- Dismissed/accepted `dedup_key`s are never re-offered; unique `(user_id, dedup_key)` makes decisions idempotent.
- Suggestions whose `requires.telegram` is unmet are hidden entirely (not disabled).
- Migration numbering: next slot is `0027`; hand-written migrations MUST be registered in `packages/db/drizzle/meta/_journal.json` (idx 27) or `drizzle-kit migrate` silently skips them. **After this ships to main, someone must run `cd packages/db && bun --env-file=../../.env run db:migrate`** — code deploy does not apply migrations.
- Commits: per repo policy subagents stage only; the controller commits on the feature branch (exception granted per-branch by the user at execution start).
- Test commands: `cd apps/backend && bun test <path>` (use `--isolate` when running multiple rag/suggestion test files together); typecheck `bun run typecheck` in `apps/backend` and `apps/desktop`.

---

## File Structure

- `packages/db/src/schema.ts` — add `suggestionDecisions` table.
- `packages/db/drizzle/0027_suggestion_decisions.sql` + `_journal.json` entry (idx 27).
- `apps/backend/src/services/schedule-quota.ts` — **new**; `ensureScheduleCapacity(user)` extracted from `routes/schedules.ts`.
- `apps/backend/src/services/suggestions/catalog.ts` — **new**; catalog + `offerableFor(userId)`.
- `apps/backend/src/routes/suggestions.ts` — **new**; GET / accept / dismiss; mounted at `/api/suggestions`.
- `apps/backend/src/routes/schedules.ts` — refactor POST to use the quota helper (behavior-preserving).
- `apps/backend/src/index.ts` — mount `suggestionsRouter`.
- `apps/desktop/src/main/index.ts`, `preload/index.ts`, `renderer/global.d.ts`, `renderer/IntegrationsPage.tsx` — IPC + UI section.

---

### Task 1: Schema + migration for suggestion decisions

**Files:**
- Modify: `packages/db/src/schema.ts` (add table near `schedules`, ~line 258)
- Create: `packages/db/drizzle/0027_suggestion_decisions.sql`
- Modify: `packages/db/drizzle/meta/_journal.json` (append idx 27)
- Test: `apps/backend/src/services/suggestions/schema-cols.test.ts`

**Interfaces:**
- Produces: `suggestionDecisions` exported from `@yomi/db` with columns `id, userId, dedupKey, decision, scheduleId, createdAt` and unique `(user_id, dedup_key)`.

- [ ] **Step 1: Add the Drizzle table**

In `packages/db/src/schema.ts`, after the `schedules` table:

```ts
export const suggestionDecisions = pgTable(
  "suggestion_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dedupKey: text("dedup_key").notNull(),
    decision: text("decision").notNull(), // 'accepted' | 'dismissed'
    scheduleId: uuid("schedule_id").references(() => schedules.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("suggestion_decisions_user_idx").on(t.userId),
    userKeyUnique: unique("suggestion_decisions_user_key_unique").on(t.userId, t.dedupKey),
  }),
)
```

- [ ] **Step 2: Write the migration**

Create `packages/db/drizzle/0027_suggestion_decisions.sql`:

```sql
CREATE TABLE IF NOT EXISTS suggestion_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  dedup_key text NOT NULL,
  decision text NOT NULL,
  schedule_id uuid REFERENCES schedules(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT suggestion_decisions_user_key_unique UNIQUE (user_id, dedup_key)
);
CREATE INDEX IF NOT EXISTS suggestion_decisions_user_idx ON suggestion_decisions (user_id);
```

Before writing, confirm the users table's SQL name by checking an existing FK migration (e.g. how `0021_schedules.sql` references it) and match it exactly.

- [ ] **Step 3: Register in the journal**

Append to `packages/db/drizzle/meta/_journal.json` entries (after idx 26, preserving valid JSON):

```json
{
  "idx": 27,
  "version": "7",
  "when": 1783468800000,
  "tag": "0027_suggestion_decisions",
  "breakpoints": true
}
```

Validate: `node -e "JSON.parse(require('fs').readFileSync('packages/db/drizzle/meta/_journal.json','utf8')); console.log('ok')"`

- [ ] **Step 4: Guard test**

Create `apps/backend/src/services/suggestions/schema-cols.test.ts`:

```ts
import { describe, expect, it } from "bun:test"
import { suggestionDecisions } from "@yomi/db"

describe("suggestion_decisions schema", () => {
  it("exports the table with dedupKey and decision", () => {
    const t = suggestionDecisions as Record<string, unknown>
    expect(t.dedupKey).toBeDefined()
    expect(t.decision).toBeDefined()
    expect(t.scheduleId).toBeDefined()
  })
})
```

- [ ] **Step 5: Run test + typecheck**

Run: `cd apps/backend && bun test src/services/suggestions/schema-cols.test.ts` — expected PASS.
Run: `cd apps/backend && bun run typecheck` — expected clean.

- [ ] **Step 6: Stage for controller commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/ apps/backend/src/services/suggestions/
```

---

### Task 2: Catalog + offerable computation

**Files:**
- Create: `apps/backend/src/services/suggestions/catalog.ts`
- Test: `apps/backend/src/services/suggestions/catalog.test.ts`

**Interfaces:**
- Consumes: `db, mcpConnections, platformConnections, suggestionDecisions` from `@yomi/db`; `validateScheduleInput` from `../schedule-parser.js` (test-only guard).
- Produces:
  - `interface SuggestionEntry { dedupKey: string; provider: string | null; title: string; description: string; requires?: { telegram?: boolean }; spec: { schedule: string; prompt: string; deliverTo: string[] } }`
  - `SUGGESTION_CATALOG: SuggestionEntry[]`
  - `offerableFor(userId: string): Promise<SuggestionEntry[]>`
  - `findEntry(dedupKey: string): SuggestionEntry | undefined`

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/services/suggestions/catalog.test.ts`:

```ts
import { describe, expect, it, mock, beforeEach } from "bun:test"

const state = { providers: [] as string[], platforms: [] as string[], decided: [] as string[] }

mock.module("@yomi/db", () => {
  const resultFor = (table: any) => {
    if (table.__name === "mcp") return state.providers.map((p) => ({ provider: p }))
    if (table.__name === "platform") return state.platforms.map((p) => ({ platform: p }))
    return state.decided.map((k) => ({ dedupKey: k }))
  }
  return {
    db: { select: () => ({ from: (t: any) => ({ where: () => Promise.resolve(resultFor(t)) }) }) },
    mcpConnections: { __name: "mcp" },
    platformConnections: { __name: "platform" },
    suggestionDecisions: { __name: "decisions" },
  }
})

const { offerableFor, SUGGESTION_CATALOG, findEntry } = await import("./catalog.js")
const { validateScheduleInput } = await import("../schedule-parser.js")

beforeEach(() => { state.providers = []; state.platforms = []; state.decided = [] })

describe("catalog", () => {
  it("every catalog schedule phrase parses", () => {
    for (const entry of SUGGESTION_CATALOG) {
      const valid = validateScheduleInput(entry.spec.schedule)
      expect(valid.ok).toBe(true)
    }
  })

  it("offers connector entries only when connected and telegram is linked", async () => {
    state.providers = ["google"]
    state.platforms = ["telegram"]
    const offers = await offerableFor("u1")
    expect(offers.some((e) => e.dedupKey === "gmail-daily-briefing-v1")).toBe(true)
    expect(offers.some((e) => e.dedupKey === "github-daily-notifications-v1")).toBe(false)
  })

  it("hides telegram-gated entries when telegram is not linked", async () => {
    state.providers = ["google"]
    state.platforms = []
    const offers = await offerableFor("u1")
    expect(offers.length).toBe(0)
  })

  it("excludes decided keys", async () => {
    state.providers = ["google"]
    state.platforms = ["telegram"]
    state.decided = ["gmail-daily-briefing-v1"]
    const offers = await offerableFor("u1")
    expect(offers.some((e) => e.dedupKey === "gmail-daily-briefing-v1")).toBe(false)
  })

  it("findEntry resolves keys and rejects unknowns", () => {
    expect(findEntry("gmail-daily-briefing-v1")?.provider).toBe("google")
    expect(findEntry("nope")).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/backend && bun test src/services/suggestions/catalog.test.ts` — expected FAIL (module not found).

- [ ] **Step 3: Implement `catalog.ts`**

```ts
import { eq } from "drizzle-orm"
import { db, mcpConnections, platformConnections, suggestionDecisions } from "@yomi/db"

export interface SuggestionEntry {
  dedupKey: string
  provider: string | null // mcp_connections provider required; null = offered to everyone
  title: string
  description: string
  requires?: { telegram?: boolean }
  spec: { schedule: string; prompt: string; deliverTo: string[] }
}

// dedupKey is versioned: bump the -vN suffix to deliberately re-offer a
// materially reworded suggestion; dismissals latch per key.
export const SUGGESTION_CATALOG: SuggestionEntry[] = [
  {
    dedupKey: "gmail-daily-briefing-v1",
    provider: "google",
    title: "Daily inbox briefing",
    description: "Every morning at 9am, a summary of unread email: sender, subject, one-line gist.",
    requires: { telegram: true },
    spec: {
      schedule: "every day 9am",
      prompt:
        "Summarize my unread emails from the last 24 hours: sender, subject, and a one-line gist, most important first. If the inbox is clear, say so briefly.",
      deliverTo: ["telegram"],
    },
  },
  {
    dedupKey: "calendar-morning-agenda-v1",
    provider: "google-calendar",
    title: "Morning agenda",
    description: "Every day at 8am, today's events with times, locations, and Meet links.",
    requires: { telegram: true },
    spec: {
      schedule: "every day 8am",
      prompt:
        "Give me today's calendar agenda: each event with time, title, and location or Meet link. Flag conflicts or back-to-back meetings.",
      deliverTo: ["telegram"],
    },
  },
  {
    dedupKey: "drive-weekly-new-files-v1",
    provider: "google-drive",
    title: "Weekly Drive digest",
    description: "Monday mornings, what changed in your Drive this past week, with links.",
    requires: { telegram: true },
    spec: {
      schedule: "every monday 9am",
      prompt:
        "List files added or modified in my Google Drive over the past 7 days, grouped sensibly, each with its link. Keep it short.",
      deliverTo: ["telegram"],
    },
  },
  {
    dedupKey: "github-daily-notifications-v1",
    provider: "github",
    title: "GitHub notifications digest",
    description: "Every evening at 6pm, unread notifications grouped by repo; review requests first.",
    requires: { telegram: true },
    spec: {
      schedule: "every day 6pm",
      prompt:
        "Summarize my unread GitHub notifications grouped by repository. Call out review requests and direct mentions first.",
      deliverTo: ["telegram"],
    },
  },
  {
    dedupKey: "daily-checkin-v1",
    provider: null,
    title: "Daily check-in",
    description: "A 5pm nudge: how did today go, anything to schedule or remember?",
    requires: { telegram: true },
    spec: {
      schedule: "every day 5pm",
      prompt:
        "Check in with me: ask how my day went and whether there's anything to schedule, follow up on, or remember for tomorrow.",
      deliverTo: ["telegram"],
    },
  },
]

export function findEntry(dedupKey: string): SuggestionEntry | undefined {
  return SUGGESTION_CATALOG.find((e) => e.dedupKey === dedupKey)
}

export async function offerableFor(userId: string): Promise<SuggestionEntry[]> {
  const [connRows, platformRows, decidedRows] = await Promise.all([
    db
      .select({ provider: mcpConnections.provider })
      .from(mcpConnections)
      .where(eq(mcpConnections.userId, userId)),
    db
      .select({ platform: platformConnections.platform })
      .from(platformConnections)
      .where(eq(platformConnections.userId, userId)),
    db
      .select({ dedupKey: suggestionDecisions.dedupKey })
      .from(suggestionDecisions)
      .where(eq(suggestionDecisions.userId, userId)),
  ])
  const providers = new Set(connRows.map((r) => r.provider))
  const hasTelegram = platformRows.some((r) => r.platform === "telegram")
  const decided = new Set(decidedRows.map((r) => r.dedupKey))

  return SUGGESTION_CATALOG.filter((entry) => {
    if (decided.has(entry.dedupKey)) return false
    if (entry.provider && !providers.has(entry.provider)) return false
    if (entry.requires?.telegram && !hasTelegram) return false
    return true
  })
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd apps/backend && bun test src/services/suggestions/catalog.test.ts` — expected 5 pass. (If the schedule-phrase guard test fails, fix the catalog's `schedule` strings to phrases `validateScheduleInput` accepts — check `apps/backend/src/services/schedule-parser.ts` for the accepted grammar — rather than weakening the test.)

- [ ] **Step 5: Typecheck + stage**

Run: `cd apps/backend && bun run typecheck` — expected clean. Then `git add apps/backend/src/services/suggestions/`.

---

### Task 3: Quota helper + suggestions routes

**Files:**
- Create: `apps/backend/src/services/schedule-quota.ts`
- Modify: `apps/backend/src/routes/schedules.ts:41-69` (use the helper; behavior-preserving)
- Create: `apps/backend/src/routes/suggestions.ts`
- Modify: `apps/backend/src/index.ts` (import + `app.route("/api/suggestions", suggestionsRouter)` next to the schedules mount at ~line 118)
- Test: `apps/backend/src/routes/suggestions.test.ts`

**Interfaces:**
- Consumes: `offerableFor`, `findEntry` (Task 2); `suggestionDecisions`, `schedules` from `@yomi/db`; `validateScheduleInput`, `computeNextRun`, `scheduleLimitForPlan` from `../services/schedule-parser.js`; `effectivePlanForUser`, `getPlanConfig`, `isOwnerUser` from `../entitlements.js`; `authenticate` from `../auth.js`.
- Produces:
  - `ensureScheduleCapacity(user): Promise<{ ok: true } | { ok: false; status: 402 | 403; body: { error: string; code: string; upgradeUrl: string } }>`
  - `suggestionsRouter` with `GET /`, `POST /:dedupKey/accept` → `{ scheduleId }`, `POST /:dedupKey/dismiss` → `{ ok: true }`.

- [ ] **Step 1: Extract the quota helper (behavior-preserving refactor)**

Create `apps/backend/src/services/schedule-quota.ts` containing EXACTLY the logic currently inline at `routes/schedules.ts:41-69`:

```ts
import { eq, sql } from "drizzle-orm"
import { db, schedules } from "@yomi/db"
import { effectivePlanForUser, getPlanConfig, isOwnerUser } from "../entitlements.js"
import { scheduleLimitForPlan } from "./schedule-parser.js"

type QuotaUser = Parameters<typeof effectivePlanForUser>[0] & Parameters<typeof getPlanConfig>[0]

export async function ensureScheduleCapacity(
  user: QuotaUser & { id: string },
): Promise<
  { ok: true } | { ok: false; status: 402 | 403; body: { error: string; code: string; upgradeUrl: string } }
> {
  if (isOwnerUser(user)) return { ok: true }
  const plan = effectivePlanForUser(user)
  const limit = scheduleLimitForPlan(plan)
  if (limit <= 0) {
    return {
      ok: false,
      status: 403,
      body: {
        error: `Scheduling isn't on your ${getPlanConfig(user).name} plan. Upgrade to Pro or Max to schedule tasks.`,
        code: "feature_not_available",
        upgradeUrl: "/dashboard?upgrade=true",
      },
    }
  }
  const countRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(schedules)
    .where(eq(schedules.userId, user.id))
  const count = Number(countRows[0]?.count ?? 0)
  if (count >= limit) {
    return {
      ok: false,
      status: 402,
      body: {
        error: `You've hit your schedule limit (${count}/${limit}). Upgrade for more.`,
        code: "schedule_limit",
        upgradeUrl: "/dashboard?upgrade=true",
      },
    }
  }
  return { ok: true }
}
```

Then in `routes/schedules.ts` POST, replace lines 41-69 with:

```ts
  const capacity = await ensureScheduleCapacity(user)
  if (!capacity.ok) return c.json(capacity.body, capacity.status)
```

(add the import; adjust the `QuotaUser` typing to whatever `c.get("user")` actually is — read the auth typing and keep it simple, `as` casts are not allowed outside tests). Run the existing schedules tests if any exist (`ls apps/backend/src/routes/schedules*.test.ts`); at minimum `bun run typecheck` must stay clean.

- [ ] **Step 2: Write the failing route tests**

Create `apps/backend/src/routes/suggestions.test.ts`. Mirror the `mock.module` header pattern of `apps/backend/src/routes/rag-drive.test.ts` for `../auth.js` (read that file first and copy its authenticate/user stub approach). Mock `../services/suggestions/catalog.js` with a two-entry catalog and controllable `offerableFor`; mock `@yomi/db` with insert/select recorders; mock `../services/schedule-quota.js` (`ensureScheduleCapacity` returning `{ok:true}` by default, overridable) and `../services/schedule-parser.js` (`validateScheduleInput` → `{ok:true, scheduleType:"phrase"}`, `computeNextRun` → fixed date).

Test cases (assert status codes AND bodies):

```ts
// GET / returns offerable entries mapped to {dedupKey,title,description,schedulePreview}
// POST /:key/accept for an offerable key: inserts a schedules row AND a decisions row
//   with decision "accepted" and the new scheduleId; returns { scheduleId }
// POST /:key/accept for a non-offerable key: 404 { code: "not_offerable" }, no inserts
// POST /:key/accept when ensureScheduleCapacity returns {ok:false,status:402,...}: 402, no inserts
// POST /:key/dismiss: inserts decision "dismissed", returns { ok: true }
// duplicate decision (mock insert throws unique-violation): accept returns 409 { code: "already_decided" }
```

- [ ] **Step 3: Run to verify failure**

Run: `cd apps/backend && bun test src/routes/suggestions.test.ts` — expected FAIL (module not found).

- [ ] **Step 4: Implement `routes/suggestions.ts`**

```ts
import { Hono } from "hono"
import { db, schedules, suggestionDecisions } from "@yomi/db"
import { authenticate } from "../auth.js"
import { offerableFor, findEntry } from "../services/suggestions/catalog.js"
import { ensureScheduleCapacity } from "../services/schedule-quota.js"
import { computeNextRun, validateScheduleInput } from "../services/schedule-parser.js"

export const suggestionsRouter = new Hono()

suggestionsRouter.use("*", authenticate)

suggestionsRouter.get("/", async (c) => {
  const user = c.get("user")
  const offers = await offerableFor(user.id)
  return c.json({
    suggestions: offers.map((e) => ({
      dedupKey: e.dedupKey,
      title: e.title,
      description: e.description,
      schedulePreview: e.spec.schedule,
    })),
  })
})

suggestionsRouter.post("/:dedupKey/accept", async (c) => {
  const user = c.get("user")
  const key = c.req.param("dedupKey")
  const entry = findEntry(key ?? "")
  const offers = await offerableFor(user.id)
  if (!entry || !offers.some((e) => e.dedupKey === entry.dedupKey)) {
    return c.json({ error: "Suggestion not available", code: "not_offerable" }, 404)
  }

  const capacity = await ensureScheduleCapacity(user)
  if (!capacity.ok) return c.json(capacity.body, capacity.status)

  const valid = validateScheduleInput(entry.spec.schedule)
  if (!valid.ok || !valid.scheduleType)
    return c.json({ error: "catalog schedule invalid", code: "invalid_schedule" }, 500)

  const [schedule] = await db
    .insert(schedules)
    .values({
      userId: user.id,
      schedule: entry.spec.schedule,
      scheduleType: valid.scheduleType,
      prompt: entry.spec.prompt,
      deliverTo: entry.spec.deliverTo,
      enabled: true,
      oneShot: false,
      nextRunAt: computeNextRun({ scheduleType: valid.scheduleType, schedule: entry.spec.schedule }),
    })
    .returning()
  if (!schedule) return c.json({ error: "failed to create schedule", code: "create_failed" }, 500)

  try {
    await db.insert(suggestionDecisions).values({
      userId: user.id,
      dedupKey: entry.dedupKey,
      decision: "accepted",
      scheduleId: schedule.id,
    })
  } catch (err) {
    // Unique violation: a concurrent accept already decided — surface it, but the
    // schedule from THIS call must not survive as a duplicate.
    await db.delete(schedules).where(eq(schedules.id, schedule.id))
    return c.json({ error: "Already decided", code: "already_decided" }, 409)
  }
  return c.json({ scheduleId: schedule.id })
})

suggestionsRouter.post("/:dedupKey/dismiss", async (c) => {
  const user = c.get("user")
  const key = c.req.param("dedupKey")
  const entry = findEntry(key ?? "")
  if (!entry) return c.json({ error: "Unknown suggestion", code: "not_offerable" }, 404)
  try {
    await db.insert(suggestionDecisions).values({
      userId: user.id,
      dedupKey: entry.dedupKey,
      decision: "dismissed",
      scheduleId: null,
    })
  } catch {
    // already decided — dismiss is idempotent
  }
  return c.json({ ok: true })
})
```

Add the missing `eq` import from `drizzle-orm`. Mount in `apps/backend/src/index.ts` next to the schedules mount:

```ts
import { suggestionsRouter } from "./routes/suggestions.js"
app.route("/api/suggestions", suggestionsRouter)
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd apps/backend && bun test src/routes/suggestions.test.ts` — expected all pass.
Run: `cd apps/backend && bun test --isolate src/services/suggestions/ src/routes/suggestions.test.ts` — expected all pass.
Run: `cd apps/backend && bun run typecheck` — expected clean.

- [ ] **Step 6: Stage for controller commit**

```bash
git add apps/backend/src/services/schedule-quota.ts apps/backend/src/routes/schedules.ts apps/backend/src/routes/suggestions.ts apps/backend/src/routes/suggestions.test.ts apps/backend/src/index.ts
```

---

### Task 4: Desktop UI — suggestion cards on the Integrations page

**Files:**
- Modify: `apps/desktop/src/main/index.ts` (3 IPC handlers next to the drive-source handlers at ~line 393)
- Modify: `apps/desktop/src/preload/index.ts` (3 invoke wrappers)
- Modify: `apps/desktop/src/renderer/global.d.ts` (type decls)
- Modify: `apps/desktop/src/renderer/IntegrationsPage.tsx` ("Suggested automations" section)

**Interfaces:**
- Consumes: `GET /api/suggestions` → `{ suggestions: [{ dedupKey, title, description, schedulePreview }] }`; `POST /api/suggestions/:dedupKey/accept` → `{ scheduleId }` | error `{ code }`; `POST /api/suggestions/:dedupKey/dismiss` → `{ ok: true }`.
- Produces: IPC channels `yomi:get-suggestions`, `yomi:accept-suggestion`, `yomi:dismiss-suggestion` (mirror the exact auth/BACKEND_URL/`loadToken()` pattern of `yomi:get-drive-sources` at `main/index.ts:393` — read those handlers first and copy their shape, including error `{ code }` passthrough from the response body).

- [ ] **Step 1: Add the three IPC handlers in `main/index.ts`**

Follow the `yomi:get-drive-sources` / `yomi:create-drive-source` / `yomi:delete-drive-source` handlers verbatim as the template: same token loading, same fetch pattern, same `{ ok, data, code }` result shape. GET hits `/api/suggestions`; accept POSTs `/api/suggestions/${encodeURIComponent(dedupKey)}/accept`; dismiss POSTs `.../dismiss`. Pass the backend's `code` through from the JSON body (do not re-derive from HTTP status).

- [ ] **Step 2: Preload + types**

Add `getSuggestions()`, `acceptSuggestion(dedupKey)`, `dismissSuggestion(dedupKey)` to the preload bridge and `global.d.ts`, matching the drive-source wrappers' shape exactly.

- [ ] **Step 3: Render the section in `IntegrationsPage.tsx`**

Below the connector marketplace (and following the file's existing state/styling idiom — read the Drive indexed-folders section first as the template): load suggestions on mount and after any integration connect/disconnect; render nothing when the list is empty; each card shows `title`, `description`, `schedulePreview`, with **Enable** and **Dismiss** buttons. On Enable success show a brief inline confirmation ("Scheduled ✓"); on error render the message inline — `schedule_limit`/`feature_not_available` → "Schedule limit reached for your plan"; `not_offerable` → refresh the list. On Dismiss, refetch.

- [ ] **Step 4: Typecheck + lint**

Run: `cd apps/desktop && bun run typecheck` — expected clean. No renderer test framework exists; do not add one.

- [ ] **Step 5: Manual verification notes (for the human)**

1. With Gmail connected + Telegram linked: cards appear on the Integrations page.
2. Enable "Daily inbox briefing" → row appears in the schedules list (existing UI/API), card disappears.
3. Dismiss another card → disappears and stays gone after restart.
4. Unlink Telegram → remaining suggestion cards disappear.

- [ ] **Step 6: Stage for controller commit**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/global.d.ts apps/desktop/src/renderer/IntegrationsPage.tsx
```

---

## Self-Review

**Spec coverage:** catalog+computation (Task 2 — includes the ~5 entries with final copy and the schedule-phrase guard test); decisions table + migration + journal + deploy note (Task 1 + Global Constraints); GET/accept/dismiss semantics incl. hidden-not-disabled telegram gate, plan-limit reuse via extracted helper, idempotent double-accept with orphan-schedule cleanup, dismiss latch (Task 3); desktop cards + IPC (Task 4); cost/plans (no new surface — helper reuse); edge cases (non-offerable accept 404, disconnect hides computed entries — inherent to `offerableFor`). ✅
**Placeholders:** none — catalog copy is finalized in Task 2; all code steps carry code. ✅
**Type consistency:** `SuggestionEntry`, `offerableFor(userId)`, `findEntry(dedupKey)`, `ensureScheduleCapacity(user)` used identically across Tasks 2-4; IPC channel names consistent between main/preload/types. ✅
**Post-merge operational step:** run `bun --env-file=../../.env run db:migrate` from `packages/db` (Global Constraints + Task 1). ✅
