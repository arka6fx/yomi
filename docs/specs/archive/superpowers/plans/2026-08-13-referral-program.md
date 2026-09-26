# Referral Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user share a personal referral link from the dashboard; when a genuinely new person signs up through it, the referrer is granted credits automatically, bounded by a lifetime cap.

**Architecture:** A new `referral_code` column on the real Better Auth `user` table (`apps/backend/src/auth-schema.ts`) and a new `referral_events` table (`packages/db/src/schema.ts`) back a small backend service (`services/referrals.ts`) exposed via `routes/referrals.ts`. The referral code travels from `apps/landing`'s `/r/[code]` redirect page through the existing `?redirect=`/`callbackURL` query-param mechanism already built into `AuthCard.tsx`, lands back on `/link?ref=<code>` after OAuth completes, and is redeemed there via a POST call — no cookies, no new Better Auth hook.

**Tech Stack:** Hono/Bun backend, Drizzle ORM + PostgreSQL, Next.js App Router (Cloudflare Worker) frontend, `bun:test` with hand-rolled `mock.module` fakes (no test DB, no vitest/jest anywhere in this repo).

## Global Constraints

- Reward: **100 credits** to the referrer only. No reward to the referred friend.
- Cap: **20 referrals / 2,000 credits lifetime** per referrer.
- Eligibility: referred account must be genuinely new — redemption is rejected if the account is more than **15 minutes** old at redemption time.
- No self-referral (referrer and referred user must differ).
- At most one credited referral event per referred user, ever (DB-level unique constraint, not just application logic).
- This repo does **not** use `drizzle-kit generate` for incremental migrations past `0000_wild_stature` — every migration since is hand-written SQL with a manually appended entry in `packages/db/drizzle/meta/_journal.json`. Do not run `bun run db:generate` for this feature; follow the hand-written pattern shown in Task 1.
- Any FK to the real `user.id` column must be declared `text(...)`, never `uuid(...)` — the stub `users` table in `packages/db/src/schema.ts` is mistyped as `uuid` but the live column is `text` (see `creditGrants`/`creditTransactions`/`telegramMiniappLoginTokens` for the correct precedent).
- Landing (`apps/landing`) never touches Postgres directly and never imports `@yomi/db` — all data access goes through the backend API.

---

## Task 1: Database schema — `referral_code` column and `referral_events` table

**Files:**
- Modify: `apps/backend/src/auth-schema.ts`
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/0036_referral_code.sql`
- Create: `packages/db/drizzle/0037_referral_events.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `authSchema.user.referralCode` (nullable `text`, unique) — consumed by Task 2.
- Produces: `referralEvents` table exported from `@yomi/db` with columns `id, referrerUserId, referredUserId, creditsGranted, createdAt` — consumed by Task 2.

- [ ] **Step 1: Add `referralCode` to the real `user` table**

In `apps/backend/src/auth-schema.ts`, find:

```ts
  pendingConnectorNudge: jsonb("pending_connector_nudge"),
  deletedAt: timestamp("deleted_at"),
```

Replace with:

```ts
  pendingConnectorNudge: jsonb("pending_connector_nudge"),
  // Referral program: this user's own shareable code, surfaced at
  // apps/landing's `/r/<code>` page. Generated lazily on first
  // GET /api/referrals/me call (services/referrals.ts), then stable for
  // life. Null until first generated.
  referralCode: text("referral_code").unique(),
  deletedAt: timestamp("deleted_at"),
```

- [ ] **Step 2: Hand-write the migration for the new column**

Create `packages/db/drizzle/0036_referral_code.sql`:

```sql
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "referral_code" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_referral_code_unique" ON "user" ("referral_code");
```

- [ ] **Step 3: Add `referralEvents` to the app schema**

In `packages/db/src/schema.ts`, find the end of the `creditTransactions` table definition:

```ts
  (t) => ({
    userCreatedIdx: index("credit_transactions_user_created_idx").on(t.userId, t.createdAt),
    idempotencyUnique: unique("credit_transactions_idempotency_unique").on(t.idempotencyKey),
  }),
)

export const processedPaymentEvents = pgTable(
```

Replace with:

```ts
  (t) => ({
    userCreatedIdx: index("credit_transactions_user_created_idx").on(t.userId, t.createdAt),
    idempotencyUnique: unique("credit_transactions_idempotency_unique").on(t.idempotencyKey),
  }),
)

export const referralEvents = pgTable(
  "referral_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referrerUserId: text("referrer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    referredUserId: text("referred_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    creditsGranted: integer("credits_granted").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    referrerIdx: index("referral_events_referrer_user_id_idx").on(t.referrerUserId),
    referredUnique: unique("referral_events_referred_user_id_unique").on(t.referredUserId),
  }),
)

export const processedPaymentEvents = pgTable(
```

- [ ] **Step 4: Hand-write the migration for the new table**

Create `packages/db/drizzle/0037_referral_events.sql`:

```sql
CREATE TABLE IF NOT EXISTS "referral_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_user_id" text NOT NULL,
	"referred_user_id" text NOT NULL,
	"credits_granted" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_referrer_user_id_user_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_referred_user_id_user_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "referral_events_referred_user_id_unique" ON "referral_events" ("referred_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_events_referrer_user_id_idx" ON "referral_events" ("referrer_user_id");
```

- [ ] **Step 5: Register both migrations in the journal**

In `packages/db/drizzle/meta/_journal.json`, find the tail:

```json
    {
      "idx": 35,
      "version": "7",
      "when": 1786406400000,
      "tag": "0035_telegram_miniapp_login_tokens",
      "breakpoints": true
    }
  ]
}
```

Replace with:

```json
    {
      "idx": 35,
      "version": "7",
      "when": 1786406400000,
      "tag": "0035_telegram_miniapp_login_tokens",
      "breakpoints": true
    },
    {
      "idx": 36,
      "version": "7",
      "when": 1786492800000,
      "tag": "0036_referral_code",
      "breakpoints": true
    },
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

- [ ] **Step 6: Typecheck**

Run: `cd packages/db && bun run typecheck && cd ../../apps/backend && bun run typecheck`
Expected: no errors (the `users` stub's FK target and `referralEvents`' new columns must resolve cleanly).

- [ ] **Step 7: Apply the migrations**

Run (from `packages/db`, against a real dev/staging `DATABASE_URL` — this is a manual step per this project's convention, not run in CI):

```bash
cd packages/db
bun run db:migrate
```

Expected: output confirms `0036_referral_code` and `0037_referral_events` applied. Verify with a quick manual check:

```bash
psql "$DATABASE_URL" -c "\d referral_events"
psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'user' AND column_name = 'referral_code';"
```

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/auth-schema.ts packages/db/src/schema.ts packages/db/drizzle/0036_referral_code.sql packages/db/drizzle/0037_referral_events.sql packages/db/drizzle/meta/_journal.json
git commit -m "feat: add referral_code column and referral_events table"
```

---

## Task 2: Referral service — credit source and core logic

**Files:**
- Modify: `apps/backend/src/services/credit-ledger.ts`
- Modify: `packages/db/src/schema.ts:153` (comment only, same line touched conceptually — see Step 1)
- Create: `apps/backend/src/services/referrals.ts`
- Test: `apps/backend/src/services/referrals.test.ts`

**Interfaces:**
- Consumes: `authSchema.user` (`{ id, referralCode }` columns, Task 1), `referralEvents` (Task 1), `grantCredits` from `credit-ledger.ts` (existing).
- Produces: `getOrCreateReferralCode(userId: string): Promise<string>`, `getReferralStats(userId: string): Promise<{ code: string; count: number; cap: number; creditsEarned: number; events: { id: string; creditsGranted: number; createdAt: Date }[] }>`, `redeemReferralCode(input: { code: string; referredUserId: string; referredUserCreatedAt: Date }): Promise<{ redeemed: boolean; reason?: string }>` — consumed by Task 3.
- Produces: `REFERRAL_CREDIT_AMOUNT` (100), `REFERRAL_CAP` (20) — exported constants, consumed by Task 3 route responses if needed and by tests.

- [ ] **Step 1: Add `"referral"` as a credit grant source**

In `apps/backend/src/services/credit-ledger.ts`, find:

```ts
export type CreditGrantSource =
  | "subscription_cycle"
  | "credit_pack"
  | "admin_adjustment"
  | "refund"
  | "migration"
  | "promo"
```

Replace with:

```ts
export type CreditGrantSource =
  | "subscription_cycle"
  | "credit_pack"
  | "admin_adjustment"
  | "refund"
  | "migration"
  | "promo"
  | "referral"
```

In `packages/db/src/schema.ts`, find:

```ts
    source: text("source").notNull(), // "subscription_cycle" | "credit_pack" | "admin_adjustment" | "refund" | "migration" | "promo"
```

Replace with:

```ts
    source: text("source").notNull(), // "subscription_cycle" | "credit_pack" | "admin_adjustment" | "refund" | "migration" | "promo" | "referral"
```

- [ ] **Step 2: Write the failing tests for the referral service**

Create `apps/backend/src/services/referrals.test.ts`:

```ts
import { beforeEach, describe, expect, it, mock } from "bun:test"

let selectQueue: unknown[][] = []
let insertedValues: Record<string, unknown>[] = []
let insertResult: unknown[] | Error = []
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
  insert: () => ({
    values: (row: Record<string, unknown>) => {
      insertedValues.push(row)
      return {
        returning: () => {
          if (insertResult instanceof Error) return Promise.reject(insertResult)
          return Promise.resolve(insertResult)
        },
      }
    },
  }),
  update: () => ({
    set: (values: Record<string, unknown>) => {
      updateSets.push(values)
      return { where: () => Promise.resolve() }
    },
  }),
}

mock.module("@yomi/db", () => ({ db: fakeDb, referralEvents: {} }))
mock.module("../auth-schema.js", () => ({ user: {} }))

let grantCreditsCalls: Record<string, unknown>[] = []
mock.module("./credit-ledger.js", () => ({
  grantCredits: async (input: Record<string, unknown>) => {
    grantCreditsCalls.push(input)
    return { granted: true, balance: 100 }
  },
}))

const { getOrCreateReferralCode, getReferralStats, redeemReferralCode } = await import(
  "./referrals.js"
)

beforeEach(() => {
  selectQueue = []
  insertedValues = []
  insertResult = []
  updateSets = []
  grantCreditsCalls = []
})

describe("getOrCreateReferralCode", () => {
  it("returns the existing code without generating a new one", async () => {
    selectQueue = [[{ referralCode: "abc12345" }]]
    const code = await getOrCreateReferralCode("user_1")
    expect(code).toBe("abc12345")
    expect(updateSets).toHaveLength(0)
  })

  it("generates and persists a new code when none exists", async () => {
    selectQueue = [[]]
    const code = await getOrCreateReferralCode("user_1")
    expect(code).toMatch(/^[0-9a-f]{8}$/)
    expect(updateSets).toHaveLength(1)
    expect(updateSets[0]?.referralCode).toBe(code)
  })
})

describe("getReferralStats", () => {
  it("returns code, count, cap, and summed credits from events", async () => {
    const createdAt1 = new Date("2026-08-01T00:00:00Z")
    const createdAt2 = new Date("2026-08-02T00:00:00Z")
    selectQueue = [
      [{ referralCode: "abc12345" }],
      [
        { id: "e1", creditsGranted: 100, createdAt: createdAt1 },
        { id: "e2", creditsGranted: 100, createdAt: createdAt2 },
      ],
    ]
    const stats = await getReferralStats("user_1")
    expect(stats).toEqual({
      code: "abc12345",
      count: 2,
      cap: 20,
      creditsEarned: 200,
      events: [
        { id: "e1", creditsGranted: 100, createdAt: createdAt1 },
        { id: "e2", creditsGranted: 100, createdAt: createdAt2 },
      ],
    })
  })
})

describe("redeemReferralCode", () => {
  const freshDate = new Date(Date.now() - 60_000) // 1 minute ago

  it("redeems successfully for a fresh, eligible account", async () => {
    selectQueue = [[{ id: "referrer_1" }], [{ count: 0 }]]
    insertResult = [{ id: "event_1" }]

    const result = await redeemReferralCode({
      code: "abc12345",
      referredUserId: "friend_1",
      referredUserCreatedAt: freshDate,
    })

    expect(result).toEqual({ redeemed: true })
    expect(insertedValues[0]).toEqual({
      referrerUserId: "referrer_1",
      referredUserId: "friend_1",
      creditsGranted: 100,
    })
    expect(grantCreditsCalls).toHaveLength(1)
    expect(grantCreditsCalls[0]).toMatchObject({
      userId: "referrer_1",
      amount: 100,
      source: "referral",
      sourceId: "referral:event_1",
      idempotencyKey: "referral:event_1:credit",
    })
  })

  it("rejects an account older than the 15-minute window", async () => {
    const oldDate = new Date(Date.now() - 20 * 60_000)
    const result = await redeemReferralCode({
      code: "abc12345",
      referredUserId: "friend_1",
      referredUserCreatedAt: oldDate,
    })
    expect(result).toEqual({ redeemed: false, reason: "not_new_account" })
    expect(insertedValues).toHaveLength(0)
    expect(grantCreditsCalls).toHaveLength(0)
  })

  it("rejects an invalid/unknown code", async () => {
    selectQueue = [[]]
    const result = await redeemReferralCode({
      code: "nope",
      referredUserId: "friend_1",
      referredUserCreatedAt: freshDate,
    })
    expect(result).toEqual({ redeemed: false, reason: "invalid_code" })
  })

  it("rejects self-referral", async () => {
    selectQueue = [[{ id: "user_1" }]]
    const result = await redeemReferralCode({
      code: "abc12345",
      referredUserId: "user_1",
      referredUserCreatedAt: freshDate,
    })
    expect(result).toEqual({ redeemed: false, reason: "self_referral" })
  })

  it("rejects once the referrer has reached the cap", async () => {
    selectQueue = [[{ id: "referrer_1" }], [{ count: 20 }]]
    const result = await redeemReferralCode({
      code: "abc12345",
      referredUserId: "friend_1",
      referredUserCreatedAt: freshDate,
    })
    expect(result).toEqual({ redeemed: false, reason: "cap_reached" })
    expect(insertedValues).toHaveLength(0)
  })

  it("rejects a duplicate redemption for the same referred user", async () => {
    selectQueue = [[{ id: "referrer_1" }], [{ count: 0 }]]
    insertResult = new Error(
      'duplicate key value violates unique constraint "referral_events_referred_user_id_unique"',
    )
    const result = await redeemReferralCode({
      code: "abc12345",
      referredUserId: "friend_1",
      referredUserCreatedAt: freshDate,
    })
    expect(result).toEqual({ redeemed: false, reason: "already_redeemed" })
    expect(grantCreditsCalls).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/backend && bun test src/services/referrals.test.ts`
Expected: FAIL — `Cannot find module './referrals.js'` (the module doesn't exist yet).

- [ ] **Step 4: Implement the service**

Create `apps/backend/src/services/referrals.ts`:

```ts
import { randomBytes } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { db, referralEvents } from "@yomi/db"
import * as authSchema from "../auth-schema.js"
import { grantCredits } from "./credit-ledger.js"

export const REFERRAL_CREDIT_AMOUNT = 100
export const REFERRAL_CAP = 20
const NEW_ACCOUNT_WINDOW_MS = 15 * 60 * 1000

function isDuplicateReferralCodeError(err: unknown): boolean {
  return String(err).includes("user_referral_code_unique")
}

function isDuplicateReferredUserError(err: unknown): boolean {
  return String(err).includes("referral_events_referred_user_id_unique")
}

export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const [existing] = await db
    .select({ referralCode: authSchema.user.referralCode })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)
  if (existing?.referralCode) return existing.referralCode

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomBytes(4).toString("hex")
    try {
      await db
        .update(authSchema.user)
        .set({ referralCode: code })
        .where(eq(authSchema.user.id, userId))
      return code
    } catch (err) {
      if (!isDuplicateReferralCodeError(err)) throw err
    }
  }
  throw new Error("failed to generate a unique referral code after 3 attempts")
}

export async function getReferralStats(userId: string) {
  const code = await getOrCreateReferralCode(userId)
  const events = await db
    .select({
      id: referralEvents.id,
      creditsGranted: referralEvents.creditsGranted,
      createdAt: referralEvents.createdAt,
    })
    .from(referralEvents)
    .where(eq(referralEvents.referrerUserId, userId))
    .orderBy(referralEvents.createdAt)
    .limit(100)

  return {
    code,
    count: events.length,
    cap: REFERRAL_CAP,
    creditsEarned: events.reduce((sum, e) => sum + e.creditsGranted, 0),
    events,
  }
}

export async function redeemReferralCode(input: {
  code: string
  referredUserId: string
  referredUserCreatedAt: Date
}): Promise<{ redeemed: boolean; reason?: string }> {
  if (Date.now() - input.referredUserCreatedAt.getTime() > NEW_ACCOUNT_WINDOW_MS) {
    return { redeemed: false, reason: "not_new_account" }
  }

  const [referrer] = await db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.referralCode, input.code))
    .limit(1)
  if (!referrer) return { redeemed: false, reason: "invalid_code" }
  if (referrer.id === input.referredUserId) return { redeemed: false, reason: "self_referral" }

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(referralEvents)
    .where(eq(referralEvents.referrerUserId, referrer.id))
    .limit(1)
  if ((countRow?.count ?? 0) >= REFERRAL_CAP) return { redeemed: false, reason: "cap_reached" }

  let eventId: string
  try {
    const [row] = await db
      .insert(referralEvents)
      .values({
        referrerUserId: referrer.id,
        referredUserId: input.referredUserId,
        creditsGranted: REFERRAL_CREDIT_AMOUNT,
      })
      .returning({ id: referralEvents.id })
    if (!row) return { redeemed: false, reason: "insert_failed" }
    eventId = row.id
  } catch (err) {
    if (isDuplicateReferredUserError(err)) return { redeemed: false, reason: "already_redeemed" }
    throw err
  }

  await grantCredits({
    userId: referrer.id,
    amount: REFERRAL_CREDIT_AMOUNT,
    source: "referral",
    sourceId: `referral:${eventId}`,
    idempotencyKey: `referral:${eventId}:credit`,
    reason: "referral_bonus",
  })

  return { redeemed: true }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/backend && bun test src/services/referrals.test.ts`
Expected: PASS, all 9 tests green.

- [ ] **Step 6: Typecheck**

Run: `cd apps/backend && bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/services/credit-ledger.ts packages/db/src/schema.ts apps/backend/src/services/referrals.ts apps/backend/src/services/referrals.test.ts
git commit -m "feat: add referral credit source and referral service"
```

---

## Task 3: Backend route — `/api/referrals`

**Files:**
- Create: `apps/backend/src/routes/referrals.ts`
- Modify: `apps/backend/src/index.ts`

**Interfaces:**
- Consumes: `getReferralStats`, `redeemReferralCode` (Task 2), `authenticate` middleware (existing, `apps/backend/src/auth.ts`).
- Produces: `GET /api/referrals/me` → `{ code, count, cap, creditsEarned, events }`; `POST /api/referrals/redeem` (body `{ code: string }`) → `{ redeemed: boolean, reason?: string }` — consumed by Task 5 (redeem call) and Task 6 (dashboard tab).

- [ ] **Step 1: Write the route**

Create `apps/backend/src/routes/referrals.ts`:

```ts
import { Hono } from "hono"
import { authenticate } from "../auth.js"
import { getReferralStats, redeemReferralCode } from "../services/referrals.js"

export const referralsRouter = new Hono()

referralsRouter.use("*", authenticate)

referralsRouter.get("/me", async (c) => {
  const user = c.get("user")
  const stats = await getReferralStats(user.id)
  return c.json(stats)
})

type RedeemBody = { code?: string }

referralsRouter.post("/redeem", async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as RedeemBody
  const code = body.code?.trim()
  if (!code) return c.json({ error: "code is required", code: "invalid_code" }, 400)

  const result = await redeemReferralCode({
    code,
    referredUserId: user.id,
    referredUserCreatedAt: user.createdAt,
  })
  return c.json(result)
})
```

- [ ] **Step 2: Mount the router**

In `apps/backend/src/index.ts`, find:

```ts
import { schedulesRouter } from "./routes/schedules.js"
```

Replace with:

```ts
import { schedulesRouter } from "./routes/schedules.js"
import { referralsRouter } from "./routes/referrals.js"
```

Then find:

```ts
app.route("/api/schedules", schedulesRouter)
```

Replace with:

```ts
app.route("/api/schedules", schedulesRouter)
app.route("/api/referrals", referralsRouter)
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/backend && bun run typecheck`
Expected: no errors. (`user.createdAt` is available on `SessionUser` — confirmed already used the same way in `apps/backend/src/entitlements.ts:82`.)

- [ ] **Step 4: Manual smoke test**

Run the backend locally (`bun run dev` per repo root), then with a real session bearer token:

```bash
curl -s http://localhost:3001/api/referrals/me -H "Authorization: Bearer <token>"
```

Expected: JSON body with `code` (8 hex chars), `count: 0`, `cap: 20`, `creditsEarned: 0`, `events: []` for a fresh account.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routes/referrals.ts apps/backend/src/index.ts
git commit -m "feat: add /api/referrals route"
```

---

## Task 4: Landing — referral redirect page

**Files:**
- Create: `apps/landing/src/app/r/[code]/page.tsx`

**Interfaces:**
- Produces: visiting `/r/<code>` redirects to `/signup?ref=<code>` — consumed by Task 5.

- [ ] **Step 1: Write the redirect page**

Create `apps/landing/src/app/r/[code]/page.tsx`:

```tsx
import { redirect } from "next/navigation"

export default async function ReferralRedirectPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  redirect(`/signup?ref=${encodeURIComponent(code)}`)
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/landing && bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run `bun run dev` (landing), visit `http://localhost:3000/r/testcode123` in a browser.
Expected: browser lands on `http://localhost:3000/signup?ref=testcode123`.

- [ ] **Step 4: Commit**

```bash
git add apps/landing/src/app/r/\[code\]/page.tsx
git commit -m "feat: add /r/[code] referral redirect page"
```

---

## Task 5: Landing — carry the referral code through signup and redeem it

**Files:**
- Modify: `apps/landing/src/components/AuthCard.tsx`
- Modify: `apps/landing/src/app/link/page.tsx`

**Interfaces:**
- Consumes: `POST /api/referrals/redeem` (Task 3), the existing `?redirect=`-aware `getRedirectTo()` in `AuthCard.tsx`, the existing `session` state in `link/page.tsx`.
- Produces: after a referred friend completes OAuth signup, `/link?ref=<code>` fires a redemption call.

- [ ] **Step 1: Carry `?ref=` through the OAuth callback URL**

In `apps/landing/src/components/AuthCard.tsx`, find:

```ts
  function getRedirectTo() {
    const params = new URLSearchParams(window.location.search)
    const selectedPlan = plan ?? params.get("plan") ?? undefined
    return (
      callbackURL ??
      params.get("redirect") ??
      (selectedPlan ? `/dashboard?plan=${selectedPlan}` : "/dashboard")
    )
  }
```

Replace with:

```ts
  function getRedirectTo() {
    const params = new URLSearchParams(window.location.search)
    const selectedPlan = plan ?? params.get("plan") ?? undefined
    const base =
      callbackURL ??
      params.get("redirect") ??
      (selectedPlan ? `/dashboard?plan=${selectedPlan}` : "/dashboard")
    const ref = params.get("ref")
    if (!ref) return base
    const separator = base.includes("?") ? "&" : "?"
    return `${base}${separator}ref=${encodeURIComponent(ref)}`
  }
```

Since `signup/page.tsx` already passes `callbackURL="/link"` to `AuthCard`, a friend arriving at `/signup?ref=<code>` now completes OAuth with a final callback of `/link?ref=<code>`.

- [ ] **Step 2: Redeem the code once the friend lands back on `/link`**

In `apps/landing/src/app/link/page.tsx`, find:

```ts
  useEffect(() => {
    if (!session) return
    void checkTelegramLinked()
      .then(setConnected)
      .catch(() => {})
  }, [session])
```

Replace with:

```ts
  useEffect(() => {
    if (!session) return
    void checkTelegramLinked()
      .then(setConnected)
      .catch(() => {})
  }, [session])

  useEffect(() => {
    if (!session) return
    const ref = new URLSearchParams(window.location.search).get("ref")
    if (!ref) return
    void fetch("/api/referrals/redeem", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.session.token}`,
      },
      body: JSON.stringify({ code: ref }),
    }).catch(() => {
      // best-effort — a stale/invalid/expired referral code must never block linking
    })
  }, [session])
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/landing && bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual end-to-end verification**

With both `apps/backend` and `apps/landing` running locally:
1. As user A (already signed in), call `GET /api/referrals/me` to get a code, e.g. `abc12345`.
2. In a separate/incognito browser, visit `http://localhost:3000/r/abc12345`.
3. Confirm redirect to `/signup?ref=abc12345`.
4. Complete Google/GitHub OAuth as a brand-new user B.
5. Confirm the browser lands on `/link?ref=abc12345`.
6. As user A, call `GET /api/referrals/me` again — expect `count: 1`, `creditsEarned: 100`, one entry in `events`.

- [ ] **Step 5: Commit**

```bash
git add apps/landing/src/components/AuthCard.tsx apps/landing/src/app/link/page.tsx
git commit -m "feat: carry referral code through signup and redeem on link"
```

---

## Task 6: Dashboard — Referrals tab

**Files:**
- Modify: `apps/landing/src/components/dashboard/SettingsMenu.tsx`
- Create: `apps/landing/src/components/dashboard/ReferralsManager.tsx`
- Modify: `apps/landing/src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /api/referrals/me` (Task 3).
- Produces: a "Referrals" entry in the dashboard settings menu that renders `ReferralsManager`.

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
} from "lucide-react"
```

Find:

```ts
  const accountItems: MenuItem[] = [
    { label: "Billing", icon: WalletCards, onClick: () => navigate("billing") },
    { label: "Privacy", icon: Shield, onClick: () => navigate("privacy") },
  ]
```

Replace with:

```ts
  const accountItems: MenuItem[] = [
    { label: "Billing", icon: WalletCards, onClick: () => navigate("billing") },
    { label: "Referrals", icon: Gift, onClick: () => navigate("referrals") },
    { label: "Privacy", icon: Shield, onClick: () => navigate("privacy") },
  ]
```

- [ ] **Step 2: Write the tab component**

Create `apps/landing/src/components/dashboard/ReferralsManager.tsx`:

```tsx
"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Copy, Gift, Loader2 } from "lucide-react"

type ReferralEvent = {
  id: string
  creditsGranted: number
  createdAt: string
}

type ReferralStats = {
  code: string
  count: number
  cap: number
  creditsEarned: number
  events: ReferralEvent[]
}

function when(value: string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function ReferralsManager({ token }: { token: string }) {
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  const auth = { Authorization: `Bearer ${token}` }

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/referrals/me", { headers: auth })
      if (!res.ok) throw new Error(`Couldn't load referrals (${res.status})`)
      const data = (await res.json()) as ReferralStats
      setStats(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load referrals")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function copyLink() {
    if (!stats) return
    const link = `${window.location.origin}/r/${stats.code}`
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 flex justify-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <p className="text-sm text-destructive">{error || "Couldn't load referrals"}</p>
      </div>
    )
  }

  const link = `${window.location.origin}/r/${stats.code}`

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3.5">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10">
          <Gift size={20} className="text-primary" />
        </div>
        <div>
          <h2 className="text-base font-medium text-foreground">Referrals</h2>
          <p className="text-sm text-muted-foreground">
            Get 100 credits for every friend who joins Yomi through your link.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 p-3">
        <code className="flex-1 truncate text-sm text-foreground">{link}</code>
        <button
          onClick={copyLink}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">Referrals used</p>
          <p className="text-lg font-medium text-foreground">
            {stats.count} <span className="text-sm text-muted-foreground">/ {stats.cap}</span>
          </p>
        </div>
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">Credits earned</p>
          <p className="text-lg font-medium text-foreground">{stats.creditsEarned}</p>
        </div>
      </div>

      {stats.events.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            History
          </p>
          <div className="space-y-1.5">
            {stats.events.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{when(e.createdAt)}</span>
                <span className="text-foreground">+{e.creditsGranted} credits</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Wire the tab into the dashboard page**

In `apps/landing/src/app/dashboard/page.tsx`, find:

```ts
import { SchedulesManager } from "@/components/dashboard/SchedulesManager"
```

Replace with:

```ts
import { SchedulesManager } from "@/components/dashboard/SchedulesManager"
import { ReferralsManager } from "@/components/dashboard/ReferralsManager"
```

Find:

```tsx
        {/* Privacy tab */}
        {activeTab === "privacy" && session && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <PrivacyManager token={session.session.token} />
          </motion.div>
        )}
```

Replace with:

```tsx
        {/* Privacy tab */}
        {activeTab === "privacy" && session && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <PrivacyManager token={session.session.token} />
          </motion.div>
        )}

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

- [ ] **Step 4: Typecheck**

Run: `cd apps/landing && bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run `bun run dev` (landing + backend), sign in, open the dashboard, click the settings gear → Referrals.
Expected: link + copy button render, "0 / 20" referrals used, "0" credits earned, no history section (since `events.length === 0`). Click Copy, confirm the button flips to "Copied" for 2 seconds and the link is on the clipboard.

- [ ] **Step 6: Commit**

```bash
git add apps/landing/src/components/dashboard/SettingsMenu.tsx apps/landing/src/components/dashboard/ReferralsManager.tsx apps/landing/src/app/dashboard/page.tsx
git commit -m "feat: add Referrals tab to dashboard"
```

---

## Post-implementation

- [ ] Run the full suite before considering this done: `bun run test && bun run typecheck` from the repo root (per this project's pre-merge convention).
- [ ] Confirm migrations `0036_referral_code` and `0037_referral_events` have been applied to the target deploy environment's database — this is a manual step, not automated by the deploy workflow.
