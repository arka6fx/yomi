# Streaks & Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track consecutive-day usage streaks per user and offer an opt-in, anonymous, dashboard-only leaderboard ranking total messages sent — cosmetic engagement features, no credit payouts.

**Architecture:** Six new scalar columns on the real Better Auth `user` table (`apps/backend/src/auth-schema.ts`), updated by a single hook in `GatewayRunner.onIncoming` right after a message is confirmed to belong to a linked, authenticated user — deliberately independent of the billing/metering pipeline. A small backend service (`services/streaks.ts`) and route (`routes/streaks.ts`) expose stats, opt-in, and the ranked leaderboard; a new dashboard tab surfaces it.

**Tech Stack:** Hono/Bun backend, Drizzle ORM + PostgreSQL, Next.js App Router frontend, `bun:test` with hand-rolled `mock.module` fakes (no test DB, no vitest/jest anywhere in this repo).

## Global Constraints

- Streak trigger: **any message from a linked, authenticated user**, one increment per UTC calendar day regardless of message count that day.
- Leaderboard metric: **total messages sent, all-time**, no substance weighting, no 30-day toggle.
- No credit rewards for streaks or leaderboard participation — cosmetic only.
- Leaderboard is **opt-in, dashboard-only** (never a public/marketing-site page), **anonymous by default** — auto-generated handle only, no custom/user-supplied handle, never derived from `name`/`email`.
- A user's leaderboard handle, once generated, is stable for the account's lifetime, including across opt-out/opt-back-in cycles.
- The update hook must **never** touch or depend on `services/metering.ts`'s `chargeUsage()` pipeline — that pipeline's charge/skip semantics don't line up with "did you talk to Yomi today," and coupling to it would make the streak trigger silently diverge from real usage.
- The existing `dailyChatCount`/`dailyVoiceCount`/`dailyImageCount`/`agentUsageCount`/`dailyResetDate` columns on `user` are confirmed dead code (nothing writes to them) — do not build on them, do not resurrect them; this feature adds its own counters.
- This repo does **not** use `drizzle-kit generate` for incremental migrations — every migration is hand-written SQL with a manually appended entry in `packages/db/drizzle/meta/_journal.json`. The next migration number is `0038`.
- Any FK to the real `user.id` column must be declared `text(...)`, never `uuid(...)` (not directly relevant here — this feature adds no new tables/FKs, only columns on `user` — but stated for completeness since other work in this repo hits this trap).

---

## Task 1: Database schema — streak and leaderboard columns on `user`

**Files:**
- Modify: `apps/backend/src/auth-schema.ts`
- Create: `packages/db/drizzle/0038_streaks_leaderboard.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `authSchema.user.currentStreak`, `.longestStreak`, `.lastActiveDate`, `.totalMessagesSent`, `.leaderboardOptIn`, `.leaderboardHandle` — consumed by Task 2.

- [ ] **Step 1: Add the six columns to the real `user` table**

In `apps/backend/src/auth-schema.ts`, find:

```ts
  referralCode: text("referral_code").unique(),
  deletedAt: timestamp("deleted_at"),
```

Replace with:

```ts
  referralCode: text("referral_code").unique(),
  // Daily-streak + leaderboard tracking (services/streaks.ts). Updated once per
  // incoming message from a linked user, in GatewayRunner.onIncoming — before
  // any billing/metering logic runs, so it reflects real usage independent of
  // credit-charging semantics.
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastActiveDate: text("last_active_date"), // YYYY-MM-DD, UTC
  totalMessagesSent: integer("total_messages_sent").notNull().default(0),
  // Opt-in, anonymous leaderboard. leaderboardHandle is generated once on first
  // opt-in (never derived from name/email) and stays stable across opt-out/back-in.
  leaderboardOptIn: boolean("leaderboard_opt_in").notNull().default(false),
  leaderboardHandle: text("leaderboard_handle"),
  deletedAt: timestamp("deleted_at"),
```

- [ ] **Step 2: Hand-write the migration**

Create `packages/db/drizzle/0038_streaks_leaderboard.sql`:

```sql
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "current_streak" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "longest_streak" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "last_active_date" text;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "total_messages_sent" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "leaderboard_opt_in" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "leaderboard_handle" text;
```

- [ ] **Step 3: Register the migration in the journal**

In `packages/db/drizzle/meta/_journal.json`, find the tail:

```json
    {
      "idx": 37,
      "version": "7",
      "when": 1786579200000,
      "tag": "0037_referral_events",
      "breakpoints": true
    }
  ]
}
```

Replace with:

```json
    {
      "idx": 37,
      "version": "7",
      "when": 1786579200000,
      "tag": "0037_referral_events",
      "breakpoints": true
    },
    {
      "idx": 38,
      "version": "7",
      "when": 1786665600000,
      "tag": "0038_streaks_leaderboard",
      "breakpoints": true
    }
  ]
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/backend && bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Apply the migration**

Run (from `packages/db`, against a real dev/staging `DATABASE_URL` — manual step, not run in CI; if no `DATABASE_URL` is available in this environment, skip actually running it and note that in your report, matching how prior migrations in this repo have been handled when no dev DB was reachable):

```bash
cd packages/db
bun run db:migrate
```

Verify:

```bash
psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'user' AND column_name LIKE '%streak%' OR column_name LIKE '%leaderboard%' OR column_name = 'total_messages_sent';"
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/auth-schema.ts packages/db/drizzle/0038_streaks_leaderboard.sql packages/db/drizzle/meta/_journal.json
git commit -m "feat: add streak and leaderboard columns to user"
```

---

## Task 2: Streaks service — activity recording, stats, opt-in, leaderboard

**Files:**
- Create: `apps/backend/src/services/streaks.ts`
- Test: `apps/backend/src/services/streaks.test.ts`

**Interfaces:**
- Consumes: `authSchema.user` columns from Task 1.
- Produces: `recordDailyActivity(userId: string): Promise<void>`, `getStreakStats(userId: string): Promise<{ currentStreak: number; longestStreak: number; totalMessagesSent: number; leaderboardOptIn: boolean; leaderboardHandle: string | null }>`, `setLeaderboardOptIn(userId: string, optIn: boolean): Promise<{ leaderboardOptIn: boolean; leaderboardHandle: string | null }>`, `getLeaderboard(userId: string): Promise<{ entries: { rank: number; handle: string; totalMessagesSent: number; isYou: boolean }[]; yourRank: number | null }>` — all consumed by Task 3 (route) and Task 4 (`recordDailyActivity` consumed by the gateway hook).

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/services/streaks.test.ts`:

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test"

let selectQueue: unknown[][] = []
let updateSets: Record<string, unknown>[] = []

function selectChain() {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(selectQueue.shift() ?? []),
  }
  return chain
}

const fakeDb = {
  select: () => selectChain(),
  update: () => ({
    set: (values: Record<string, unknown>) => {
      updateSets.push(values)
      return { where: () => Promise.resolve() }
    },
  }),
}

mock.module("@yomi/db", () => ({ db: fakeDb }))
mock.module("../auth-schema.js", () => ({ user: {} }))

const { recordDailyActivity, getStreakStats, setLeaderboardOptIn, getLeaderboard } = await import(
  "./streaks.js"
)

beforeEach(() => {
  selectQueue = []
  updateSets = []
})

function daysAgoUtc(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

describe("recordDailyActivity", () => {
  it("starts the streak at 1 on a user's first-ever message", async () => {
    selectQueue = [[{ currentStreak: 0, longestStreak: 0, lastActiveDate: null }]]
    await recordDailyActivity("user_1")
    expect(updateSets).toHaveLength(1)
    expect(updateSets[0]).toMatchObject({ currentStreak: 1, longestStreak: 1 })
    expect(updateSets[0]?.lastActiveDate).toBe(daysAgoUtc(0))
  })

  it("increments the streak for a message the day after the last one", async () => {
    selectQueue = [[{ currentStreak: 3, longestStreak: 5, lastActiveDate: daysAgoUtc(1) }]]
    await recordDailyActivity("user_1")
    expect(updateSets[0]).toMatchObject({
      currentStreak: 4,
      longestStreak: 5,
      lastActiveDate: daysAgoUtc(0),
    })
  })

  it("raises longestStreak when the current streak surpasses it", async () => {
    selectQueue = [[{ currentStreak: 5, longestStreak: 5, lastActiveDate: daysAgoUtc(1) }]]
    await recordDailyActivity("user_1")
    expect(updateSets[0]).toMatchObject({ currentStreak: 6, longestStreak: 6 })
  })

  it("resets the streak to 1 after a gap of 2+ days", async () => {
    selectQueue = [[{ currentStreak: 10, longestStreak: 10, lastActiveDate: daysAgoUtc(2) }]]
    await recordDailyActivity("user_1")
    expect(updateSets[0]).toMatchObject({ currentStreak: 1, longestStreak: 10 })
  })

  it("leaves the streak fields untouched for a second message the same UTC day, but still records the message", async () => {
    selectQueue = [[{ currentStreak: 4, longestStreak: 4, lastActiveDate: daysAgoUtc(0) }]]
    await recordDailyActivity("user_1")
    expect(updateSets).toHaveLength(1)
    expect(updateSets[0]).not.toHaveProperty("currentStreak")
    expect(updateSets[0]).not.toHaveProperty("lastActiveDate")
    expect(updateSets[0]).toHaveProperty("totalMessagesSent")
  })

  it("no-ops if the user row can't be found", async () => {
    selectQueue = [[]]
    await recordDailyActivity("user_missing")
    expect(updateSets).toHaveLength(0)
  })
})

describe("getStreakStats", () => {
  it("returns the persisted stats for a user", async () => {
    selectQueue = [
      [
        {
          currentStreak: 3,
          longestStreak: 7,
          totalMessagesSent: 42,
          leaderboardOptIn: true,
          leaderboardHandle: "quiet-falcon-3f2a",
        },
      ],
    ]
    const result = await getStreakStats("user_1")
    expect(result).toEqual({
      currentStreak: 3,
      longestStreak: 7,
      totalMessagesSent: 42,
      leaderboardOptIn: true,
      leaderboardHandle: "quiet-falcon-3f2a",
    })
  })

  it("returns zeroed defaults if the user row can't be found", async () => {
    selectQueue = [[]]
    const result = await getStreakStats("user_missing")
    expect(result).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      totalMessagesSent: 0,
      leaderboardOptIn: false,
      leaderboardHandle: null,
    })
  })
})

describe("setLeaderboardOptIn", () => {
  it("generates and persists a handle on first opt-in", async () => {
    selectQueue = [[{ leaderboardHandle: null }]]
    const result = await setLeaderboardOptIn("user_1", true)
    expect(result.leaderboardOptIn).toBe(true)
    expect(result.leaderboardHandle).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{4}$/)
    expect(updateSets[0]).toMatchObject({ leaderboardOptIn: true })
    expect(updateSets[0]?.leaderboardHandle).toBe(result.leaderboardHandle)
  })

  it("reuses the existing handle when opting back in after an opt-out", async () => {
    selectQueue = [[{ leaderboardHandle: "quiet-falcon-3f2a" }]]
    const result = await setLeaderboardOptIn("user_1", true)
    expect(result).toEqual({ leaderboardOptIn: true, leaderboardHandle: "quiet-falcon-3f2a" })
    expect(updateSets[0]).toEqual({ leaderboardOptIn: true })
  })

  it("opting out clears leaderboardOptIn but leaves the handle untouched", async () => {
    selectQueue = [[{ leaderboardHandle: "quiet-falcon-3f2a" }]]
    const result = await setLeaderboardOptIn("user_1", false)
    expect(result).toEqual({ leaderboardOptIn: false, leaderboardHandle: "quiet-falcon-3f2a" })
    expect(updateSets[0]).toEqual({ leaderboardOptIn: false })
  })
})

describe("getLeaderboard", () => {
  it("ranks opted-in users by totalMessagesSent descending and flags the viewer", async () => {
    selectQueue = [
      [
        { id: "user_2", handle: "swift-otter-11aa", totalMessagesSent: 50 },
        { id: "user_1", handle: "quiet-falcon-3f2a", totalMessagesSent: 30 },
      ],
    ]
    const result = await getLeaderboard("user_1")
    expect(result.entries).toEqual([
      { rank: 1, handle: "swift-otter-11aa", totalMessagesSent: 50, isYou: false },
      { rank: 2, handle: "quiet-falcon-3f2a", totalMessagesSent: 30, isYou: true },
    ])
    expect(result.yourRank).toBe(2)
  })

  it("computes yourRank for an opted-in viewer outside the visible top N", async () => {
    selectQueue = [
      [{ id: "user_2", handle: "swift-otter-11aa", totalMessagesSent: 50 }],
      [{ leaderboardOptIn: true, totalMessagesSent: 10 }],
      [{ count: 4 }],
    ]
    const result = await getLeaderboard("user_1")
    expect(result.entries.every((e) => !e.isYou)).toBe(true)
    expect(result.yourRank).toBe(5)
  })

  it("returns yourRank null for a non-opted-in viewer outside the top N", async () => {
    selectQueue = [
      [{ id: "user_2", handle: "swift-otter-11aa", totalMessagesSent: 50 }],
      [{ leaderboardOptIn: false, totalMessagesSent: 0 }],
    ]
    const result = await getLeaderboard("user_1")
    expect(result.yourRank).toBeNull()
  })

  it("returns an empty leaderboard cleanly when nobody has opted in", async () => {
    selectQueue = [[], [{ leaderboardOptIn: false, totalMessagesSent: 0 }]]
    const result = await getLeaderboard("user_1")
    expect(result.entries).toEqual([])
    expect(result.yourRank).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && bun test src/services/streaks.test.ts`
Expected: FAIL — `Cannot find module './streaks.js'`.

- [ ] **Step 3: Implement the service**

Create `apps/backend/src/services/streaks.ts`:

```ts
import { randomBytes } from "node:crypto"
import { and, desc, eq, sql } from "drizzle-orm"
import { db } from "@yomi/db"
import * as authSchema from "../auth-schema.js"

const LEADERBOARD_LIMIT = 50

const HANDLE_ADJECTIVES = [
  "quiet",
  "swift",
  "brave",
  "calm",
  "bright",
  "bold",
  "gentle",
  "clever",
  "steady",
  "quick",
  "sharp",
  "keen",
  "wise",
  "eager",
  "vivid",
  "nimble",
]
const HANDLE_NOUNS = [
  "falcon",
  "otter",
  "maple",
  "comet",
  "ember",
  "harbor",
  "willow",
  "granite",
  "cedar",
  "raven",
  "meadow",
  "quartz",
  "lynx",
  "aspen",
  "delta",
  "orbit",
]

function isDuplicateHandleError(err: unknown): boolean {
  return String(err).includes("leaderboard_handle")
}

function generateHandle(): string {
  const adjective = HANDLE_ADJECTIVES[Math.floor(Math.random() * HANDLE_ADJECTIVES.length)]
  const noun = HANDLE_NOUNS[Math.floor(Math.random() * HANDLE_NOUNS.length)]
  const suffix = randomBytes(2).toString("hex")
  return `${adjective}-${noun}-${suffix}`
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function yesterdayUtc(from: string): string {
  const d = new Date(`${from}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export async function recordDailyActivity(userId: string): Promise<void> {
  const [row] = await db
    .select({
      currentStreak: authSchema.user.currentStreak,
      longestStreak: authSchema.user.longestStreak,
      lastActiveDate: authSchema.user.lastActiveDate,
    })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)
  if (!row) return

  const today = todayUtc()
  if (row.lastActiveDate === today) {
    await db
      .update(authSchema.user)
      .set({ totalMessagesSent: sql`${authSchema.user.totalMessagesSent} + 1` })
      .where(eq(authSchema.user.id, userId))
    return
  }

  const wasYesterday = row.lastActiveDate === yesterdayUtc(today)
  const newStreak = wasYesterday ? row.currentStreak + 1 : 1
  const newLongest = Math.max(row.longestStreak, newStreak)

  await db
    .update(authSchema.user)
    .set({
      totalMessagesSent: sql`${authSchema.user.totalMessagesSent} + 1`,
      currentStreak: newStreak,
      longestStreak: newLongest,
      lastActiveDate: today,
    })
    .where(eq(authSchema.user.id, userId))
}

export async function getStreakStats(userId: string): Promise<{
  currentStreak: number
  longestStreak: number
  totalMessagesSent: number
  leaderboardOptIn: boolean
  leaderboardHandle: string | null
}> {
  const [row] = await db
    .select({
      currentStreak: authSchema.user.currentStreak,
      longestStreak: authSchema.user.longestStreak,
      totalMessagesSent: authSchema.user.totalMessagesSent,
      leaderboardOptIn: authSchema.user.leaderboardOptIn,
      leaderboardHandle: authSchema.user.leaderboardHandle,
    })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)
  return (
    row ?? {
      currentStreak: 0,
      longestStreak: 0,
      totalMessagesSent: 0,
      leaderboardOptIn: false,
      leaderboardHandle: null,
    }
  )
}

export async function setLeaderboardOptIn(
  userId: string,
  optIn: boolean,
): Promise<{ leaderboardOptIn: boolean; leaderboardHandle: string | null }> {
  const [row] = await db
    .select({ leaderboardHandle: authSchema.user.leaderboardHandle })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)

  const existingHandle = row?.leaderboardHandle ?? null

  if (optIn && !existingHandle) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = generateHandle()
      try {
        await db
          .update(authSchema.user)
          .set({ leaderboardHandle: candidate, leaderboardOptIn: true })
          .where(eq(authSchema.user.id, userId))
        return { leaderboardOptIn: true, leaderboardHandle: candidate }
      } catch (err) {
        if (!isDuplicateHandleError(err)) throw err
      }
    }
    throw new Error("failed to generate a unique leaderboard handle after 3 attempts")
  }

  await db
    .update(authSchema.user)
    .set({ leaderboardOptIn: optIn })
    .where(eq(authSchema.user.id, userId))
  return { leaderboardOptIn: optIn, leaderboardHandle: existingHandle }
}

export async function getLeaderboard(userId: string): Promise<{
  entries: { rank: number; handle: string; totalMessagesSent: number; isYou: boolean }[]
  yourRank: number | null
}> {
  const top = await db
    .select({
      id: authSchema.user.id,
      handle: authSchema.user.leaderboardHandle,
      totalMessagesSent: authSchema.user.totalMessagesSent,
    })
    .from(authSchema.user)
    .where(eq(authSchema.user.leaderboardOptIn, true))
    .orderBy(desc(authSchema.user.totalMessagesSent))
    .limit(LEADERBOARD_LIMIT)

  const entries = top.map((row, index) => ({
    rank: index + 1,
    handle: row.handle ?? "anonymous",
    totalMessagesSent: row.totalMessagesSent,
    isYou: row.id === userId,
  }))

  const inTop = entries.find((e) => e.isYou)
  if (inTop) return { entries, yourRank: inTop.rank }

  const [viewer] = await db
    .select({
      leaderboardOptIn: authSchema.user.leaderboardOptIn,
      totalMessagesSent: authSchema.user.totalMessagesSent,
    })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)

  if (!viewer?.leaderboardOptIn) return { entries, yourRank: null }

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(authSchema.user)
    .where(
      and(
        eq(authSchema.user.leaderboardOptIn, true),
        sql`${authSchema.user.totalMessagesSent} > ${viewer.totalMessagesSent}`,
      ),
    )
    .limit(1)

  return { entries, yourRank: (countRow?.count ?? 0) + 1 }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && bun test src/services/streaks.test.ts`
Expected: PASS, all 14 tests green.

- [ ] **Step 5: Typecheck**

Run: `cd apps/backend && bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/services/streaks.ts apps/backend/src/services/streaks.test.ts
git commit -m "feat: add streaks and leaderboard service"
```

---

## Task 3: Backend route — `/api/streaks`

**Files:**
- Create: `apps/backend/src/routes/streaks.ts`
- Modify: `apps/backend/src/index.ts`

**Interfaces:**
- Consumes: `getStreakStats`, `setLeaderboardOptIn`, `getLeaderboard` (Task 2), `authenticate` middleware (existing).
- Produces: `GET /api/streaks/me`, `POST /api/streaks/opt-in` (body `{ optIn: boolean }`), `GET /api/streaks/leaderboard` — consumed by Task 5 (dashboard tab).

- [ ] **Step 1: Write the route**

Create `apps/backend/src/routes/streaks.ts`:

```ts
import { Hono } from "hono"
import { authenticate } from "../auth.js"
import { getLeaderboard, getStreakStats, setLeaderboardOptIn } from "../services/streaks.js"

export const streaksRouter = new Hono()

streaksRouter.use("*", authenticate)

streaksRouter.get("/me", async (c) => {
  const user = c.get("user")
  const stats = await getStreakStats(user.id)
  return c.json(stats)
})

type OptInBody = { optIn?: boolean }

streaksRouter.post("/opt-in", async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as OptInBody
  if (typeof body.optIn !== "boolean") {
    return c.json({ error: "optIn must be a boolean", code: "invalid_opt_in" }, 400)
  }
  const result = await setLeaderboardOptIn(user.id, body.optIn)
  return c.json(result)
})

streaksRouter.get("/leaderboard", async (c) => {
  const user = c.get("user")
  const result = await getLeaderboard(user.id)
  return c.json(result)
})
```

- [ ] **Step 2: Mount the router**

In `apps/backend/src/index.ts`, find:

```ts
import { referralsRouter } from "./routes/referrals.js"
```

Replace with:

```ts
import { referralsRouter } from "./routes/referrals.js"
import { streaksRouter } from "./routes/streaks.js"
```

Then find:

```ts
app.route("/api/referrals", referralsRouter)
```

Replace with:

```ts
app.route("/api/referrals", referralsRouter)
app.route("/api/streaks", streaksRouter)
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/backend && bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/routes/streaks.ts apps/backend/src/index.ts
git commit -m "feat: add /api/streaks route"
```

---

## Task 4: Wire the activity hook into the gateway

**Files:**
- Modify: `apps/backend/src/gateway/gateway-runner.ts`
- Modify: `apps/backend/src/gateway/gateway-runner.test.ts`

**Interfaces:**
- Consumes: `recordDailyActivity` (Task 2).

- [ ] **Step 1: Call `recordDailyActivity` right after a message is resolved to a linked user**

In `apps/backend/src/gateway/gateway-runner.ts`, find:

```ts
import { consumeCredits, getCreditSummary } from "../services/credit-ledger.js"
```

Replace with:

```ts
import { consumeCredits, getCreditSummary } from "../services/credit-ledger.js"
import { recordDailyActivity } from "../services/streaks.js"
```

Then find:

```ts
      const yomiUserId = await this.resolveYomiUserId(msg.platform, msg.userId)
      console.warn(
        `[gateway] resolved yomiUserId=${yomiUserId ?? "unknown"} text="${msg.text.slice(0, 60)}"`,
      )
      if (!yomiUserId) return

      let conversationConsent = await checkConsent(yomiUserId, "conversation_history").catch(
```

Replace with:

```ts
      const yomiUserId = await this.resolveYomiUserId(msg.platform, msg.userId)
      console.warn(
        `[gateway] resolved yomiUserId=${yomiUserId ?? "unknown"} text="${msg.text.slice(0, 60)}"`,
      )
      if (!yomiUserId) return

      // Streaks/leaderboard: counts every message from a linked user, independent
      // of billing/metering — a resumed or skipped-charge turn should still count
      // as "you talked to Yomi today." Best-effort: must never block a reply.
      void recordDailyActivity(yomiUserId).catch((err) => {
        console.error("[gateway] recordDailyActivity failed:", err)
      })

      let conversationConsent = await checkConsent(yomiUserId, "conversation_history").catch(
```

This placement fires for every message type that reaches a resolved, linked user — including bare commands like `/help`/`/stop`/`/new` (confirmed against the existing test `"replies locally to bare %s without reaching the agent path"` in `gateway-runner.test.ts`, which shows these commands already pass through `isUserLinked`/`resolveYomiUserId` before their own short-circuit later in the function) — matching the spec's "any message from a linked user" intent, and resolving that spec's open question.

- [ ] **Step 2: Add the test double and reset it between tests**

In `apps/backend/src/gateway/gateway-runner.test.ts`, find:

```ts
mock.module("../services/credit-ledger.js", () => ({
  consumeCredits: async () => ({ ok: true, charged: 1, balance: 99 }),
  createPaymentRecord: async () => "payment_1",
  getCreditSummary: async () => ({
    balance: 0,
    lifetimeGranted: 0,
    lifetimeConsumed: 0,
    lifetimeRefunded: 0,
    expiringSoon: 0,
    expiringSoonAt: null,
  }),
  grantCredits: async () => ({ granted: true, balance: 100 }),
  recentCreditTransactions: async () => [],
  expireUserCredits: async () => 0,
}))

const { GatewayRunner } = await import("./gateway-runner.js")
```

Replace with:

```ts
mock.module("../services/credit-ledger.js", () => ({
  consumeCredits: async () => ({ ok: true, charged: 1, balance: 99 }),
  createPaymentRecord: async () => "payment_1",
  getCreditSummary: async () => ({
    balance: 0,
    lifetimeGranted: 0,
    lifetimeConsumed: 0,
    lifetimeRefunded: 0,
    expiringSoon: 0,
    expiringSoonAt: null,
  }),
  grantCredits: async () => ({ granted: true, balance: 100 }),
  recentCreditTransactions: async () => [],
  expireUserCredits: async () => 0,
}))

let recordDailyActivityCalls: string[] = []
mock.module("../services/streaks.js", () => ({
  recordDailyActivity: async (userId: string) => {
    recordDailyActivityCalls.push(userId)
  },
}))

const { GatewayRunner } = await import("./gateway-runner.js")
```

Then find the `beforeEach` block:

```ts
  recordedTelemetry.length = 0
  globalThis.fetch = (async () => {
    throw new Error("fetch should not run")
  }) as typeof fetch
})
```

Replace with:

```ts
  recordedTelemetry.length = 0
  recordDailyActivityCalls = []
  globalThis.fetch = (async () => {
    throw new Error("fetch should not run")
  }) as typeof fetch
})
```

- [ ] **Step 3: Add a covering test**

In `apps/backend/src/gateway/gateway-runner.test.ts`, find:

```ts
  it("runs backend agent for normal Telegram messages", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "search my notion notes",
      timestamp: new Date().toISOString(),
    })

    expect(agentCalls).toEqual([
      {
        userId: "user_1",
        text: "search my notion notes",
        history: [],
        signal: agentCalls[0]?.signal,
      },
    ])
    expect(adapter.messages.at(-1)?.text).toBe("backend reply")
    expect(appendedTurns).toEqual([
      {
        sessionId: "session_1",
        userId: "user_1",
        userText: "search my notion notes",
        assistantText: "backend reply",
      },
    ])
  })
```

Immediately after that test (still inside `describe("GatewayRunner production routing", ...)`), add:

```ts

  it("records daily activity for the resolved user on every incoming message from a linked user", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "search my notion notes",
      timestamp: new Date().toISOString(),
    })

    expect(recordDailyActivityCalls).toEqual(["user_1"])
  })

  it("still records daily activity for a bare command that short-circuits before the agent", async () => {
    const runner = new GatewayRunner()
    const adapter = new FakeAdapter()
    runner.registerAdapter(adapter)

    await incoming(runner, {
      platform: "telegram",
      chatId: "chat_1",
      userId: "tg_1",
      text: "/help",
      timestamp: new Date().toISOString(),
    })

    expect(recordDailyActivityCalls).toEqual(["user_1"])
  })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && bun test src/gateway/gateway-runner.test.ts`
Expected: PASS — the full existing suite in this file plus the 2 new tests, all green. This file is large (1400+ lines); if anything unrelated fails, stop and investigate before concluding your change caused it — check `git stash` your edit and re-run to confirm the failure predates your change.

- [ ] **Step 5: Typecheck**

Run: `cd apps/backend && bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/gateway/gateway-runner.ts apps/backend/src/gateway/gateway-runner.test.ts
git commit -m "feat: record daily activity for streaks on every incoming message"
```

---

## Task 5: Dashboard — Streaks tab

**Files:**
- Modify: `apps/landing/src/components/dashboard/SettingsMenu.tsx`
- Create: `apps/landing/src/components/dashboard/StreaksManager.tsx`
- Modify: `apps/landing/src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /api/streaks/me`, `GET /api/streaks/leaderboard`, `POST /api/streaks/opt-in` (Task 3).
- Produces: a "Streaks" entry in the dashboard settings menu rendering `StreaksManager`.

- [ ] **Step 1: Register the tab**

In `apps/landing/src/components/dashboard/SettingsMenu.tsx`, find:

```ts
export type DashboardTab =
  | "home"
  | "integrations"
  | "memory"
  | "schedules"
  | "conversation"
  | "status"
  | "billing"
  | "profile"
  | "writing-style"
  | "privacy"
  | "referrals"
```

Replace with:

```ts
export type DashboardTab =
  | "home"
  | "integrations"
  | "memory"
  | "schedules"
  | "conversation"
  | "status"
  | "billing"
  | "profile"
  | "writing-style"
  | "privacy"
  | "referrals"
  | "streaks"
```

Find:

```ts
import {
  Settings,
  Plug,
  Brain,
  User,
  PenLine,
  Code2,
  WalletCards,
  Shield,
  BookOpen,
  Gift,
} from "lucide-react"
```

Replace with:

```ts
import {
  Settings,
  Plug,
  Brain,
  User,
  PenLine,
  Code2,
  WalletCards,
  Shield,
  BookOpen,
  Gift,
  Flame,
} from "lucide-react"
```

Find:

```ts
  const accountItems: MenuItem[] = [
    { label: "Billing", icon: WalletCards, onClick: () => navigate("billing") },
    { label: "Referrals", icon: Gift, onClick: () => navigate("referrals") },
    { label: "Privacy", icon: Shield, onClick: () => navigate("privacy") },
  ]
```

Replace with:

```ts
  const accountItems: MenuItem[] = [
    { label: "Billing", icon: WalletCards, onClick: () => navigate("billing") },
    { label: "Referrals", icon: Gift, onClick: () => navigate("referrals") },
    { label: "Streaks", icon: Flame, onClick: () => navigate("streaks") },
    { label: "Privacy", icon: Shield, onClick: () => navigate("privacy") },
  ]
```

- [ ] **Step 2: Write the tab component**

Create `apps/landing/src/components/dashboard/StreaksManager.tsx`:

```tsx
"use client"

import { useCallback, useEffect, useState } from "react"
import { Flame, Loader2, Trophy } from "lucide-react"

type StreakStats = {
  currentStreak: number
  longestStreak: number
  totalMessagesSent: number
  leaderboardOptIn: boolean
  leaderboardHandle: string | null
}

type LeaderboardEntry = {
  rank: number
  handle: string
  totalMessagesSent: number
  isYou: boolean
}

type Leaderboard = {
  entries: LeaderboardEntry[]
  yourRank: number | null
}

export function StreaksManager({ token }: { token: string }) {
  const [stats, setStats] = useState<StreakStats | null>(null)
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [actionError, setActionError] = useState("")
  const [toggling, setToggling] = useState(false)

  const auth = { Authorization: `Bearer ${token}` }

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [statsRes, leaderboardRes] = await Promise.all([
        fetch("/api/streaks/me", { headers: auth }),
        fetch("/api/streaks/leaderboard", { headers: auth }),
      ])
      if (!statsRes.ok) throw new Error(`Couldn't load streak stats (${statsRes.status})`)
      if (!leaderboardRes.ok) throw new Error(`Couldn't load leaderboard (${leaderboardRes.status})`)
      setStats((await statsRes.json()) as StreakStats)
      setLeaderboard((await leaderboardRes.json()) as Leaderboard)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load streaks")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function toggleOptIn() {
    if (!stats || toggling) return
    setToggling(true)
    setActionError("")
    try {
      const res = await fetch("/api/streaks/opt-in", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ optIn: !stats.leaderboardOptIn }),
      })
      if (!res.ok) throw new Error(`Couldn't update leaderboard setting (${res.status})`)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't update leaderboard setting")
    } finally {
      setToggling(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 flex justify-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !stats || !leaderboard) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <p className="text-sm text-destructive">{error || "Couldn't load streaks"}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-5 flex items-start gap-3.5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10">
            <Flame size={20} className="text-primary" />
          </div>
          <div>
            <h2 className="text-base font-medium text-foreground">Streaks</h2>
            <p className="text-sm text-muted-foreground">
              Message Yomi every day to keep your streak alive.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Current streak</p>
            <p className="text-lg font-medium text-foreground">{stats.currentStreak}</p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Longest streak</p>
            <p className="text-lg font-medium text-foreground">{stats.longestStreak}</p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Messages sent</p>
            <p className="text-lg font-medium text-foreground">{stats.totalMessagesSent}</p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between rounded-xl border border-border bg-muted/30 p-3">
          <div>
            <p className="text-sm text-foreground">Join the leaderboard</p>
            <p className="text-xs text-muted-foreground">
              {stats.leaderboardOptIn
                ? `Visible as "${stats.leaderboardHandle}" — anonymous, no real name shown.`
                : "Opt in to appear on the leaderboard below, anonymously."}
            </p>
          </div>
          <button
            onClick={toggleOptIn}
            disabled={toggling}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {stats.leaderboardOptIn ? "Opted in" : "Opt in"}
          </button>
        </div>
        {actionError && <p className="mt-2 text-xs text-destructive">{actionError}</p>}
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <Trophy size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Leaderboard</h3>
        </div>
        {leaderboard.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody&apos;s opted in yet.</p>
        ) : (
          <div className="space-y-1.5">
            {leaderboard.entries.map((entry) => (
              <div
                key={entry.rank}
                className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-sm ${
                  entry.isYou ? "bg-primary/10" : ""
                }`}
              >
                <span className="text-muted-foreground">
                  #{entry.rank} {entry.handle}
                  {entry.isYou && <span className="text-foreground"> (you)</span>}
                </span>
                <span className="text-foreground">{entry.totalMessagesSent}</span>
              </div>
            ))}
            {leaderboard.yourRank !== null && leaderboard.yourRank > leaderboard.entries.length && (
              <div className="flex items-center justify-between rounded-lg bg-primary/10 px-2 py-1.5 text-sm">
                <span className="text-muted-foreground">
                  #{leaderboard.yourRank} {stats.leaderboardHandle}
                  <span className="text-foreground"> (you)</span>
                </span>
                <span className="text-foreground">{stats.totalMessagesSent}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Wire the tab into the dashboard page**

In `apps/landing/src/app/dashboard/page.tsx`, find:

```ts
import { ReferralsManager } from "@/components/dashboard/ReferralsManager"
```

Replace with:

```ts
import { ReferralsManager } from "@/components/dashboard/ReferralsManager"
import { StreaksManager } from "@/components/dashboard/StreaksManager"
```

Find:

```tsx
        {/* Referrals tab */}
        {activeTab === "referrals" && session && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <ReferralsManager token={session.session.token} />
          </motion.div>
        )}
```

Replace with:

```tsx
        {/* Referrals tab */}
        {activeTab === "referrals" && session && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <ReferralsManager token={session.session.token} />
          </motion.div>
        )}

        {/* Streaks tab */}
        {activeTab === "streaks" && session && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <StreaksManager token={session.session.token} />
          </motion.div>
        )}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/landing && bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run `bun run dev` (landing + backend), sign in, open the dashboard, click the settings gear → Streaks.
Expected: current/longest streak and messages-sent tiles render (0s for a fresh account), "Opt in" button, and "Nobody's opted in yet." in the leaderboard section. Click "Opt in" — button flips to "Opted in", the handle text appears, and (once at least one opted-in user exists) the leaderboard table populates.

- [ ] **Step 6: Commit**

```bash
git add apps/landing/src/components/dashboard/SettingsMenu.tsx apps/landing/src/components/dashboard/StreaksManager.tsx apps/landing/src/app/dashboard/page.tsx
git commit -m "feat: add Streaks tab to dashboard"
```

---

## Post-implementation

- [ ] Run the full suite before considering this done: `bun run test && bun run typecheck` from the repo root.
- [ ] Confirm migration `0038_streaks_leaderboard` has been applied to the target deploy environment's database before/immediately after this merges to `main` — the backend auto-deploys on push, and (per the referral program's precedent) a missing column on `user` breaks every Better Auth session check, not just this feature.
