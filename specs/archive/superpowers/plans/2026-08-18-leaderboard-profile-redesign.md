# Leaderboard + Profile Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip the streaks leaderboard from opt-in/anonymous to visible-by-default with a hide toggle, add plan badges per row and a Folk-style visual pass, and give users a real Profile page (avatar upload, editable name, username, current plan) that replaces the inline username editor on the Streaks tab.

**Architecture:** Reuse the existing `user`-table-extension pattern (one new column, one default flip on an existing column), reuse the existing S3 client in `asset-storage.ts` for avatar uploads under a new `avatars/` prefix, move identity-editing endpoints from `streaksRouter` to `profileRouter`, and add one small unauthenticated image-serving route (mirroring the existing `/api/assets/:encodedKey` pattern) since `<img>` tags can't send Authorization headers.

**Tech Stack:** Hono (backend routes), Drizzle + PostgreSQL (`apps/backend/src/auth-schema.ts`), `@aws-sdk/client-s3` (already wired in `asset-storage.ts`), Next.js/React (dashboard), `bun:test`.

**Spec:** `specs/archive/superpowers/specs/2026-08-18-leaderboard-profile-redesign-design.md`

## Global Constraints

- `leaderboardOptIn` is reused in place — it now means "visible on the leaderboard," default `true`. Do not rename the column.
- Every user must have a `leaderboardHandle` once they've sent a message or been backfilled — no more lazy generation gated on opt-in.
- Avatar uploads: image/jpeg, image/png, image/gif, image/webp only, 5MB max, stored under `avatars/{userId}/{uuid}.ext` in the existing `YOMI_ASSETS_BUCKET`.
- **Manual, non-code prerequisite before shipping:** the `avatars/` prefix must be excluded from the bucket's 30-day lifecycle deletion rule (AWS console/IaC change outside this repo). Flag this to the user; do not treat it as blocking code review, but do not consider the feature done until confirmed.
- No public/marketing leaderboard page, no clickable navigation to other users' profiles — dashboard-only, own-profile-only (confirmed decisions in the spec).
- No image cropping UI — upload as-is, display via `object-fit: cover`.
- Follow existing code conventions exactly: `bun:test` with `mock.module`, Hono routers, the `Avatar` component pattern already in `StreaksManager.tsx`, Tailwind classes matching the surrounding dashboard components.

---

### Task 1: Data model — schema + migration

**Files:**
- Modify: `apps/backend/src/auth-schema.ts:53-60`
- Create: `packages/db/drizzle/0041_leaderboard_default_visible.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `authSchema.user.customAvatarKey` (nullable text column), `authSchema.user.leaderboardOptIn` now defaults `true`. Every later task that touches `user` rows reads/writes these via `authSchema` exactly as today.

- [ ] **Step 1: Edit `auth-schema.ts`**

Replace lines 53-60 (the comment block and the three leaderboard columns) with:

```ts
  // Leaderboard visibility (default: visible). leaderboardHandle is generated
  // the first time a user sends a message (see services/streaks.ts) if they
  // don't already have one, never derived from name/email, and stays stable
  // for the account's lifetime once generated. leaderboardOptIn now means
  // "visible on the leaderboard" — flipping it off hides the user without
  // clearing their handle. customAvatarKey is a separate S3 object key for an
  // uploaded avatar; kept apart from `image` (above) because Better Auth
  // overwrites `image` from the Google profile photo on every sign-in, which
  // would silently wipe out a custom upload if it lived in the same column.
  // Display precedence: customAvatarKey -> image -> generic icon.
  // leaderboardShowPhoto lets the user hide their photo (whichever one is
  // active) in favor of a generic avatar.
  leaderboardOptIn: boolean("leaderboard_opt_in").notNull().default(true),
  leaderboardHandle: text("leaderboard_handle").unique(),
  leaderboardShowPhoto: boolean("leaderboard_show_photo").notNull().default(true),
  customAvatarKey: text("custom_avatar_key"),
```

- [ ] **Step 2: Write the migration**

Create `packages/db/drizzle/0041_leaderboard_default_visible.sql`:

```sql
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "custom_avatar_key" text;
ALTER TABLE "user" ALTER COLUMN "leaderboard_opt_in" SET DEFAULT true;
UPDATE "user" SET "leaderboard_opt_in" = true WHERE "leaderboard_opt_in" = false;
```

- [ ] **Step 3: Register the migration in the journal**

Edit `packages/db/drizzle/meta/_journal.json`, appending to the `entries` array (after the `0040_leaderboard_show_photo` entry, following the existing `when` increment-by-one-day pattern):

```json
    {
      "idx": 41,
      "version": "7",
      "when": 1786924800000,
      "tag": "0041_leaderboard_default_visible",
      "breakpoints": true
    }
```

- [ ] **Step 4: Verify the schema compiles**

Run: `cd apps/backend && bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/auth-schema.ts packages/db/drizzle/0041_leaderboard_default_visible.sql packages/db/drizzle/meta/_journal.json
git commit -m "feat: flip leaderboard visibility default and add custom avatar column"
```

---

### Task 2: Service layer — `services/streaks.ts`

**Files:**
- Modify: `apps/backend/src/services/streaks.ts`
- Test: `apps/backend/src/services/streaks.test.ts`

**Interfaces:**
- Consumes: `authSchema.user.{leaderboardOptIn,leaderboardHandle,customAvatarKey,plan,...}` from Task 1.
- Produces: `ensureLeaderboardHandle(userId: string): Promise<string>`, `getAvatarKey(userId: string): Promise<string | null>` (new exports, used by Task 4's serving route and the backfill script in Task 5). `setLeaderboardOptIn` no longer generates handles. `getStreakStats` and `getLeaderboard` both gain a `plan: string` field and resolve `avatarUrl` as `customAvatarKey ? "/api/user/avatar/{id}" : (image ?? null)`.

- [ ] **Step 1: Write the failing tests**

In `apps/backend/src/services/streaks.test.ts`:

1. Replace the entire `describe("recordDailyActivity", ...)` block — every existing fixture row gains `leaderboardHandle: "existing-handle"` (so the new handle-generation branch doesn't fire for tests that aren't about it), and one new test is added for the generation branch itself:

```ts
describe("recordDailyActivity", () => {
  it("starts the streak at 1 on a user's first-ever message", async () => {
    selectQueue = [[{ currentStreak: 0, longestStreak: 0, lastActiveDate: null, leaderboardHandle: "existing-handle" }]]
    await recordDailyActivity("user_1")
    expect(updateSets).toHaveLength(1)
    expect(updateSets[0]).toMatchObject({ currentStreak: 1, longestStreak: 1 })
    expect(updateSets[0]?.lastActiveDate).toBe(daysAgoUtc(0))
  })

  it("increments the streak for a message the day after the last one", async () => {
    selectQueue = [[{ currentStreak: 3, longestStreak: 5, lastActiveDate: daysAgoUtc(1), leaderboardHandle: "existing-handle" }]]
    await recordDailyActivity("user_1")
    expect(updateSets[0]).toMatchObject({
      currentStreak: 4,
      longestStreak: 5,
      lastActiveDate: daysAgoUtc(0),
    })
  })

  it("raises longestStreak when the current streak surpasses it", async () => {
    selectQueue = [[{ currentStreak: 5, longestStreak: 5, lastActiveDate: daysAgoUtc(1), leaderboardHandle: "existing-handle" }]]
    await recordDailyActivity("user_1")
    expect(updateSets[0]).toMatchObject({ currentStreak: 6, longestStreak: 6 })
  })

  it("resets the streak to 1 after a gap of 2+ days", async () => {
    selectQueue = [[{ currentStreak: 10, longestStreak: 10, lastActiveDate: daysAgoUtc(2), leaderboardHandle: "existing-handle" }]]
    await recordDailyActivity("user_1")
    expect(updateSets[0]).toMatchObject({ currentStreak: 1, longestStreak: 10 })
  })

  it("leaves the streak fields untouched for a second message the same UTC day, but still records the message", async () => {
    selectQueue = [[{ currentStreak: 4, longestStreak: 4, lastActiveDate: daysAgoUtc(0), leaderboardHandle: "existing-handle" }]]
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

  it("generates a leaderboard handle on a user's first-ever message when none exists yet", async () => {
    selectQueue = [[{ currentStreak: 0, longestStreak: 0, lastActiveDate: null, leaderboardHandle: null }]]
    await recordDailyActivity("user_1")
    expect(updateSets).toHaveLength(2)
    expect(updateSets[0]?.leaderboardHandle).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{4}$/)
    expect(updateSets[1]).toMatchObject({ currentStreak: 1, longestStreak: 1 })
  })
})
```

2. Replace the entire `describe("setLeaderboardOptIn", ...)` block (it no longer generates handles):

```ts
describe("setLeaderboardOptIn", () => {
  it("flips leaderboardOptIn to true and returns the existing handle untouched", async () => {
    selectQueue = [[{ leaderboardHandle: "quiet-falcon-3f2a" }]]
    const result = await setLeaderboardOptIn("user_1", true)
    expect(result).toEqual({ leaderboardOptIn: true, leaderboardHandle: "quiet-falcon-3f2a" })
    expect(updateSets).toEqual([{ leaderboardOptIn: true }])
  })

  it("flips leaderboardOptIn to false (hides the user) and leaves the handle untouched", async () => {
    selectQueue = [[{ leaderboardHandle: "quiet-falcon-3f2a" }]]
    const result = await setLeaderboardOptIn("user_1", false)
    expect(result).toEqual({ leaderboardOptIn: false, leaderboardHandle: "quiet-falcon-3f2a" })
    expect(updateSets).toEqual([{ leaderboardOptIn: false }])
  })

  it("returns a null handle if the user somehow doesn't have one yet", async () => {
    selectQueue = [[{ leaderboardHandle: null }]]
    const result = await setLeaderboardOptIn("user_1", true)
    expect(result).toEqual({ leaderboardOptIn: true, leaderboardHandle: null })
  })
})

describe("ensureLeaderboardHandle", () => {
  it("generates and persists a handle", async () => {
    const handle = await ensureLeaderboardHandle("user_1")
    expect(handle).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{4}$/)
    expect(updateSets[0]?.leaderboardHandle).toBe(handle)
  })

  it("retries with a freshly generated handle when the first candidate collides", async () => {
    updateBehaviors = [
      new Error('duplicate key value violates unique constraint "user_leaderboard_handle_unique"'),
    ]
    const handle = await ensureLeaderboardHandle("user_1")
    expect(updateSets).toHaveLength(2)
    expect(updateSets[1]?.leaderboardHandle).toBe(handle)
    expect(updateSets[0]?.leaderboardHandle).not.toBe(handle)
  })
})

describe("getAvatarKey", () => {
  it("returns the user's custom avatar key", async () => {
    selectQueue = [[{ customAvatarKey: "avatars/user_1/abc.png" }]]
    expect(await getAvatarKey("user_1")).toBe("avatars/user_1/abc.png")
  })

  it("returns null when the user has no custom avatar or doesn't exist", async () => {
    selectQueue = [[{ customAvatarKey: null }]]
    expect(await getAvatarKey("user_1")).toBeNull()
    selectQueue = [[]]
    expect(await getAvatarKey("user_missing")).toBeNull()
  })
})
```

3. Update `getStreakStats` tests to account for the new `customAvatarKey` field and `plan` field:

```ts
describe("getStreakStats", () => {
  it("returns the persisted stats for a user, preferring the Google photo when there's no custom avatar", async () => {
    selectQueue = [
      [
        {
          currentStreak: 3,
          longestStreak: 7,
          totalMessagesSent: 42,
          leaderboardOptIn: true,
          leaderboardHandle: "quiet-falcon-3f2a",
          leaderboardShowPhoto: true,
          image: "https://lh3.googleusercontent.com/a/photo.jpg",
          customAvatarKey: null,
          plan: "pro",
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
      leaderboardShowPhoto: true,
      avatarUrl: "https://lh3.googleusercontent.com/a/photo.jpg",
      plan: "pro",
    })
  })

  it("prefers the custom avatar over the Google photo when one's been uploaded", async () => {
    selectQueue = [
      [
        {
          currentStreak: 0,
          longestStreak: 0,
          totalMessagesSent: 0,
          leaderboardOptIn: true,
          leaderboardHandle: "quiet-falcon-3f2a",
          leaderboardShowPhoto: true,
          image: "https://lh3.googleusercontent.com/a/photo.jpg",
          customAvatarKey: "avatars/user_1/abc.png",
          plan: "explore",
        },
      ],
    ]
    const result = await getStreakStats("user_1")
    expect(result.avatarUrl).toBe("/api/user/avatar/user_1")
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
      leaderboardShowPhoto: true,
      avatarUrl: null,
      plan: "explore",
    })
  })
})
```

4. Update `getLeaderboard` tests to include `plan` and `customAvatarKey` in fixtures and assertions:

```ts
describe("getLeaderboard", () => {
  it("ranks visible users by totalMessagesSent descending, flags the viewer, and includes avatars and plans", async () => {
    selectQueue = [
      [
        {
          id: "user_2",
          handle: "swift-otter-11aa",
          totalMessagesSent: 50,
          image: "https://lh3.googleusercontent.com/a/other.jpg",
          customAvatarKey: null,
          leaderboardShowPhoto: true,
          plan: "max",
        },
        {
          id: "user_1",
          handle: "quiet-falcon-3f2a",
          totalMessagesSent: 30,
          image: "https://lh3.googleusercontent.com/a/mine.jpg",
          customAvatarKey: "avatars/user_1/abc.png",
          leaderboardShowPhoto: false,
          plan: "explore",
        },
      ],
    ]
    const result = await getLeaderboard("user_1")
    expect(result.entries).toEqual([
      {
        rank: 1,
        handle: "swift-otter-11aa",
        totalMessagesSent: 50,
        isYou: false,
        avatarUrl: "https://lh3.googleusercontent.com/a/other.jpg",
        plan: "max",
      },
      {
        rank: 2,
        handle: "quiet-falcon-3f2a",
        totalMessagesSent: 30,
        isYou: true,
        avatarUrl: null,
        plan: "explore",
      },
    ])
    expect(result.yourRank).toBe(2)
  })

  it("computes yourRank for a visible viewer outside the visible top N", async () => {
    selectQueue = [
      [
        {
          id: "user_2",
          handle: "swift-otter-11aa",
          totalMessagesSent: 50,
          image: null,
          customAvatarKey: null,
          leaderboardShowPhoto: true,
          plan: "explore",
        },
      ],
      [{ leaderboardOptIn: true, totalMessagesSent: 10 }],
      [{ count: 4 }],
    ]
    const result = await getLeaderboard("user_1")
    expect(result.entries.every((e) => !e.isYou)).toBe(true)
    expect(result.yourRank).toBe(5)
  })

  it("returns yourRank null for a hidden viewer outside the top N", async () => {
    selectQueue = [
      [
        {
          id: "user_2",
          handle: "swift-otter-11aa",
          totalMessagesSent: 50,
          image: null,
          customAvatarKey: null,
          leaderboardShowPhoto: true,
          plan: "explore",
        },
      ],
      [{ leaderboardOptIn: false, totalMessagesSent: 0 }],
    ]
    const result = await getLeaderboard("user_1")
    expect(result.yourRank).toBeNull()
  })

  it("returns an empty leaderboard cleanly when nobody's visible", async () => {
    selectQueue = [[], [{ leaderboardOptIn: false, totalMessagesSent: 0 }]]
    const result = await getLeaderboard("user_1")
    expect(result.entries).toEqual([])
    expect(result.yourRank).toBeNull()
  })
})
```

5. Add the new exports to the destructured import at the top of the file:

```ts
const {
  recordDailyActivity,
  getStreakStats,
  setLeaderboardOptIn,
  updateLeaderboardHandle,
  setLeaderboardShowPhoto,
  getLeaderboard,
  ensureLeaderboardHandle,
  getAvatarKey,
} = await import("./streaks.js")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && bun test src/services/streaks.test.ts`
Expected: FAIL — `ensureLeaderboardHandle` and `getAvatarKey` are not exported yet, and the updated assertions don't match current behavior.

- [ ] **Step 3: Rewrite `streaks.ts`**

Replace the full contents of `apps/backend/src/services/streaks.ts` with:

```ts
import { randomBytes } from "node:crypto"
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm"
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

const HANDLE_PATTERN = /^[a-z][a-z0-9-]{2,23}$/

function isDuplicateHandleError(err: unknown): boolean {
  return String(err).includes("user_leaderboard_handle_unique")
}

function generateHandle(): string {
  const adjective = HANDLE_ADJECTIVES[Math.floor(Math.random() * HANDLE_ADJECTIVES.length)]
  const noun = HANDLE_NOUNS[Math.floor(Math.random() * HANDLE_NOUNS.length)]
  const suffix = randomBytes(2).toString("hex")
  return `${adjective}-${noun}-${suffix}`
}

function avatarUrlFor(row: { id: string; image: string | null; customAvatarKey: string | null }) {
  if (row.customAvatarKey) return `/api/user/avatar/${row.id}`
  return row.image ?? null
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function yesterdayUtc(from: string): string {
  const d = new Date(`${from}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// Generates and persists a unique leaderboard handle for a user who doesn't
// have one yet. Called both from recordDailyActivity (a user's first-ever
// message) and the one-off backfill script for pre-existing users.
export async function ensureLeaderboardHandle(userId: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = generateHandle()
    try {
      await db
        .update(authSchema.user)
        .set({ leaderboardHandle: candidate })
        .where(eq(authSchema.user.id, userId))
      return candidate
    } catch (err) {
      if (!isDuplicateHandleError(err)) throw err
    }
  }
  throw new Error("failed to generate a unique leaderboard handle after 3 attempts")
}

export async function getAvatarKey(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ customAvatarKey: authSchema.user.customAvatarKey })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)
  return row?.customAvatarKey ?? null
}

export async function recordDailyActivity(userId: string): Promise<void> {
  const [row] = await db
    .select({
      currentStreak: authSchema.user.currentStreak,
      longestStreak: authSchema.user.longestStreak,
      lastActiveDate: authSchema.user.lastActiveDate,
      leaderboardHandle: authSchema.user.leaderboardHandle,
    })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)
  if (!row) return

  if (!row.leaderboardHandle) {
    await ensureLeaderboardHandle(userId)
  }

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
  leaderboardShowPhoto: boolean
  avatarUrl: string | null
  plan: string
}> {
  const [row] = await db
    .select({
      currentStreak: authSchema.user.currentStreak,
      longestStreak: authSchema.user.longestStreak,
      totalMessagesSent: authSchema.user.totalMessagesSent,
      leaderboardOptIn: authSchema.user.leaderboardOptIn,
      leaderboardHandle: authSchema.user.leaderboardHandle,
      leaderboardShowPhoto: authSchema.user.leaderboardShowPhoto,
      image: authSchema.user.image,
      customAvatarKey: authSchema.user.customAvatarKey,
      plan: authSchema.user.plan,
    })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)
  if (!row) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      totalMessagesSent: 0,
      leaderboardOptIn: false,
      leaderboardHandle: null,
      leaderboardShowPhoto: true,
      avatarUrl: null,
      plan: "explore",
    }
  }
  return {
    currentStreak: row.currentStreak,
    longestStreak: row.longestStreak,
    totalMessagesSent: row.totalMessagesSent,
    leaderboardOptIn: row.leaderboardOptIn,
    leaderboardHandle: row.leaderboardHandle,
    leaderboardShowPhoto: row.leaderboardShowPhoto,
    avatarUrl: avatarUrlFor({ id: userId, image: row.image, customAvatarKey: row.customAvatarKey }),
    plan: row.plan,
  }
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

  await db
    .update(authSchema.user)
    .set({ leaderboardOptIn: optIn })
    .where(eq(authSchema.user.id, userId))

  return { leaderboardOptIn: optIn, leaderboardHandle: row?.leaderboardHandle ?? null }
}

export async function updateLeaderboardHandle(
  userId: string,
  handle: string,
): Promise<{ ok: true; leaderboardHandle: string } | { ok: false; error: string }> {
  const trimmed = handle.trim().toLowerCase()
  if (!HANDLE_PATTERN.test(trimmed)) {
    return {
      ok: false,
      error:
        "Handle must be 3-24 characters: lowercase letters, numbers, and dashes, starting with a letter.",
    }
  }
  try {
    await db
      .update(authSchema.user)
      .set({ leaderboardHandle: trimmed })
      .where(eq(authSchema.user.id, userId))
    return { ok: true, leaderboardHandle: trimmed }
  } catch (err) {
    if (isDuplicateHandleError(err)) {
      return { ok: false, error: "That handle is already taken — try another." }
    }
    throw err
  }
}

export async function setLeaderboardShowPhoto(
  userId: string,
  showPhoto: boolean,
): Promise<{ leaderboardShowPhoto: boolean }> {
  await db
    .update(authSchema.user)
    .set({ leaderboardShowPhoto: showPhoto })
    .where(eq(authSchema.user.id, userId))
  return { leaderboardShowPhoto: showPhoto }
}

export async function getLeaderboard(userId: string): Promise<{
  entries: {
    rank: number
    handle: string
    totalMessagesSent: number
    isYou: boolean
    avatarUrl: string | null
    plan: string
  }[]
  yourRank: number | null
}> {
  const top = await db
    .select({
      id: authSchema.user.id,
      handle: authSchema.user.leaderboardHandle,
      totalMessagesSent: authSchema.user.totalMessagesSent,
      image: authSchema.user.image,
      customAvatarKey: authSchema.user.customAvatarKey,
      leaderboardShowPhoto: authSchema.user.leaderboardShowPhoto,
      plan: authSchema.user.plan,
    })
    .from(authSchema.user)
    .where(and(eq(authSchema.user.leaderboardOptIn, true), isNull(authSchema.user.deletedAt)))
    .orderBy(desc(authSchema.user.totalMessagesSent), asc(authSchema.user.id))
    .limit(LEADERBOARD_LIMIT)

  const entries = top.map((row, index) => ({
    rank: index + 1,
    handle: row.handle ?? "anonymous",
    totalMessagesSent: row.totalMessagesSent,
    isYou: row.id === userId,
    avatarUrl: row.leaderboardShowPhoto
      ? avatarUrlFor({ id: row.id, image: row.image, customAvatarKey: row.customAvatarKey })
      : null,
    plan: row.plan,
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
        isNull(authSchema.user.deletedAt),
        sql`${authSchema.user.totalMessagesSent} > ${viewer.totalMessagesSent}`,
      ),
    )
    .limit(1)

  return { entries, yourRank: (countRow?.count ?? 0) + 1 }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && bun test src/services/streaks.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/streaks.ts apps/backend/src/services/streaks.test.ts
git commit -m "feat: generate leaderboard handles unconditionally, add plan and custom avatar to streaks service"
```

---

### Task 3: Avatar upload helper — `services/asset-storage.ts`

**Files:**
- Modify: `apps/backend/src/services/asset-storage.ts`

**Interfaces:**
- Consumes: existing `client()`, `resolveAssetType()` in the same file.
- Produces: `uploadAvatar(userId: string, bytes: ArrayBuffer, contentType: string): Promise<{ key: string; contentType: string } | null>`. Task 4's route calls this; avatar bytes are read back later via the existing `fetchAsset(key)` (already generic — no changes needed there).

No dedicated test file — matches this file's existing precedent: `uploadAsset` (the function this mirrors) has no direct unit test either, since it's a thin wrapper around the real S3 SDK. Coverage comes from Task 4's route test, which mocks this module.

- [ ] **Step 1: Add `uploadAvatar`**

In `apps/backend/src/services/asset-storage.ts`, add this function directly after `uploadAsset` (after its closing brace, currently ending around line 163):

```ts
// Uploads an avatar under a dedicated `avatars/` prefix, distinct from the
// `assets/` prefix used for transient Telegram attachments — this prefix must
// be excluded from the bucket's 30-day lifecycle deletion rule (an AWS
// console/IaC change outside this repo). Unlike uploadAsset, this doesn't
// return a presigned URL: avatars are served through the stable
// GET /api/user/avatar/:userId proxy route instead, since a presigned URL's
// hour-long expiry doesn't work for an image referenced from many viewers'
// leaderboard rows over time.
export async function uploadAvatar(
  userId: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<{ key: string; contentType: string } | null> {
  const cfg = client()
  if (!cfg) return null

  const body = new Uint8Array(bytes)
  const resolved = resolveAssetType(contentType, body)
  const key = `avatars/${userId}/${crypto.randomUUID()}.${resolved.extension}`

  await cfg.client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: resolved.contentType,
    }),
  )

  return { key, contentType: resolved.contentType }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/backend && bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/services/asset-storage.ts
git commit -m "feat: add uploadAvatar to asset storage service"
```

---

### Task 4: Routes — move identity endpoints to `/api/user`, add avatar upload + serving

**Files:**
- Modify: `apps/backend/src/routes/profile.ts`
- Modify: `apps/backend/src/routes/profile.test.ts`
- Modify: `apps/backend/src/routes/streaks.ts`
- Modify: `apps/backend/src/index.ts`

**Interfaces:**
- Consumes: `uploadAvatar` (Task 3), `getAvatarKey`, `updateLeaderboardHandle`, `setLeaderboardShowPhoto` (Task 2), `fetchAsset` (existing).
- Produces: `POST /api/user/avatar` → `{ avatarUrl: string }`; `POST /api/user/handle` → `{ leaderboardHandle: string }`; `POST /api/user/show-photo` → `{ leaderboardShowPhoto: boolean }`; `GET /api/user/avatar/:userId` → image bytes or 404. `streaksRouter` keeps only `GET /me`, `POST /opt-in`, `GET /leaderboard`.

- [ ] **Step 1: Write the failing route tests**

In `apps/backend/src/routes/profile.test.ts`, add these mocks near the top (after the existing `mock.module` calls, before the `profileRouter` import):

```ts
let uploadAvatarResult: { key: string; contentType: string } | null = {
  key: "avatars/user_1/abc.png",
  contentType: "image/png",
}
mock.module("../services/asset-storage.js", () => ({
  uploadAvatar: async () => uploadAvatarResult,
}))

let handleResult: { ok: true; leaderboardHandle: string } | { ok: false; error: string } = {
  ok: true,
  leaderboardHandle: "arka",
}
let showPhotoResult = { leaderboardShowPhoto: true }
mock.module("../services/streaks.js", () => ({
  updateLeaderboardHandle: async () => handleResult,
  setLeaderboardShowPhoto: async () => showPhotoResult,
}))
```

Add these request helpers next to `updateProfile`:

```ts
function postAvatar(bytes: Uint8Array, contentType: string) {
  return app().request("/api/user/avatar", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: bytes,
  })
}

function postHandle(handle: unknown) {
  return app().request("/api/user/handle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle }),
  })
}

function postShowPhoto(showPhoto: unknown) {
  return app().request("/api/user/show-photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ showPhoto }),
  })
}
```

Add these describe blocks at the end of the file:

```ts
describe("POST /api/user/avatar", () => {
  beforeEach(() => {
    currentUser = { id: "user_1" }
    uploadAvatarResult = { key: "avatars/user_1/abc.png", contentType: "image/png" }
    updateCalls = 0
  })

  it("uploads a valid image and returns the avatar URL", async () => {
    const res = await postAvatar(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png")
    const body = (await res.json()) as { avatarUrl?: string }

    expect(res.status).toBe(200)
    expect(body.avatarUrl).toBe("/api/user/avatar/user_1")
    expect(updatePayload).toEqual({ customAvatarKey: "avatars/user_1/abc.png" })
  })

  it("rejects a non-image content type", async () => {
    const res = await postAvatar(new Uint8Array([1, 2, 3]), "application/pdf")
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_avatar_type")
    expect(updateCalls).toBe(0)
  })

  it("rejects a payload over the 5MB size cap", async () => {
    const bytes = new Uint8Array(5 * 1024 * 1024 + 1)
    const res = await postAvatar(bytes, "image/png")
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("avatar_too_large")
    expect(updateCalls).toBe(0)
  })

  it("returns 503 when avatar storage isn't configured", async () => {
    uploadAvatarResult = null
    const res = await postAvatar(new Uint8Array([1, 2, 3]), "image/png")
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(503)
    expect(body.code).toBe("avatar_storage_unavailable")
    expect(updateCalls).toBe(0)
  })
})

describe("POST /api/user/handle", () => {
  beforeEach(() => {
    currentUser = { id: "user_1" }
    handleResult = { ok: true, leaderboardHandle: "arka" }
  })

  it("saves a valid handle", async () => {
    const res = await postHandle("Arka")
    const body = (await res.json()) as { leaderboardHandle?: string }

    expect(res.status).toBe(200)
    expect(body.leaderboardHandle).toBe("arka")
  })

  it("rejects a missing handle", async () => {
    const res = await postHandle(undefined)
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_handle")
  })

  it("surfaces a taken-handle error from the service", async () => {
    handleResult = { ok: false, error: "That handle is already taken — try another." }
    const res = await postHandle("taken")
    const body = (await res.json()) as { error?: string; code?: string }

    expect(res.status).toBe(400)
    expect(body.error).toBe("That handle is already taken — try another.")
    expect(body.code).toBe("invalid_handle")
  })
})

describe("POST /api/user/show-photo", () => {
  beforeEach(() => {
    currentUser = { id: "user_1" }
    showPhotoResult = { leaderboardShowPhoto: false }
  })

  it("updates the photo-visibility preference", async () => {
    const res = await postShowPhoto(false)
    const body = (await res.json()) as { leaderboardShowPhoto?: boolean }

    expect(res.status).toBe(200)
    expect(body.leaderboardShowPhoto).toBe(false)
  })

  it("rejects a non-boolean showPhoto", async () => {
    const res = await postShowPhoto("yes")
    const body = (await res.json()) as { code?: string }

    expect(res.status).toBe(400)
    expect(body.code).toBe("invalid_show_photo")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && bun test src/routes/profile.test.ts`
Expected: FAIL — the new routes don't exist yet on `profileRouter`.

- [ ] **Step 3: Add the routes to `profile.ts`**

In `apps/backend/src/routes/profile.ts`, add these imports at the top:

```ts
import { uploadAvatar } from "../services/asset-storage.js"
import { setLeaderboardShowPhoto, updateLeaderboardHandle } from "../services/streaks.js"
```

Append these route handlers after the existing `profileRouter.patch("/profile", ...)` block:

```ts
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

profileRouter.post("/avatar", authenticate, async (c) => {
  const user = c.get("user")
  const contentType = c.req.header("content-type") ?? ""
  if (!ALLOWED_AVATAR_TYPES.has(contentType)) {
    return c.json(
      { error: "Avatar must be a JPEG, PNG, GIF, or WEBP image", code: "invalid_avatar_type" },
      400,
    )
  }

  const bytes = await c.req.arrayBuffer()
  if (bytes.byteLength > MAX_AVATAR_BYTES) {
    return c.json({ error: "Avatar must be 5MB or smaller", code: "avatar_too_large" }, 400)
  }

  const uploaded = await uploadAvatar(user.id, bytes, contentType)
  if (!uploaded) {
    return c.json(
      { error: "Avatar storage isn't configured", code: "avatar_storage_unavailable" },
      503,
    )
  }

  await db
    .update(authSchema.user)
    .set({ customAvatarKey: uploaded.key })
    .where(eq(authSchema.user.id, user.id))

  return c.json({ avatarUrl: `/api/user/avatar/${user.id}` })
})

type HandleBody = { handle?: string }

profileRouter.post("/handle", authenticate, async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as HandleBody
  if (typeof body.handle !== "string" || !body.handle.trim()) {
    return c.json({ error: "handle is required", code: "invalid_handle" }, 400)
  }
  const result = await updateLeaderboardHandle(user.id, body.handle)
  if (!result.ok) {
    return c.json({ error: result.error, code: "invalid_handle" }, 400)
  }
  return c.json({ leaderboardHandle: result.leaderboardHandle })
})

type ShowPhotoBody = { showPhoto?: boolean }

profileRouter.post("/show-photo", authenticate, async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as ShowPhotoBody
  if (typeof body.showPhoto !== "boolean") {
    return c.json({ error: "showPhoto must be a boolean", code: "invalid_show_photo" }, 400)
  }
  const result = await setLeaderboardShowPhoto(user.id, body.showPhoto)
  return c.json(result)
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/backend && bun test src/routes/profile.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Remove the moved endpoints from `streaksRouter`**

Replace the full contents of `apps/backend/src/routes/streaks.ts` with:

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

- [ ] **Step 6: Add the public avatar-serving route to `index.ts`**

In `apps/backend/src/index.ts`, add an import for `getAvatarKey` (no `authSchema` or `eq` needed — `getAvatarKey` already encapsulates the DB query):

```ts
import { getAvatarKey } from "./services/streaks.js"
```

Add this route directly after the existing `app.get("/api/assets/:encodedKey", ...)` block (around line 128), unauthenticated — matching that route's precedent, since an `<img>` tag can't send an Authorization header and the object key isn't guessable/sensitive:

```ts
app.get("/api/user/avatar/:userId", async (c) => {
  try {
    const key = await getAvatarKey(c.req.param("userId"))
    if (!key) return c.notFound()
    const asset = await fetchAsset(key)
    if (!asset) return c.notFound()
    return new Response(asset.bytes, {
      status: 200,
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  } catch (err) {
    console.error("[avatar] fetch failed:", err instanceof Error ? err.message : err)
    return c.notFound()
  }
})
```


- [ ] **Step 7: Verify everything compiles and the full backend test suite passes**

Run: `cd apps/backend && bun run typecheck && bun test`
Expected: no type errors, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/routes/profile.ts apps/backend/src/routes/profile.test.ts apps/backend/src/routes/streaks.ts apps/backend/src/index.ts
git commit -m "feat: move leaderboard identity endpoints to /api/user, add avatar upload and serving"
```

---

### Task 5: Migration + handle backfill (manual execution, not part of automated tests)

**Files:**
- Create: `apps/backend/scripts/backfill-leaderboard-handles.ts`

**Interfaces:**
- Consumes: `ensureLeaderboardHandle` (Task 2).

- [ ] **Step 1: Write the backfill script**

Create `apps/backend/scripts/backfill-leaderboard-handles.ts`:

```ts
// One-off backfill: every user needs a leaderboard handle now that the
// leaderboard shows everyone by default, not just users who opted in.
// Generates one for any row where it's still null.
//
//   bun apps/backend/scripts/backfill-leaderboard-handles.ts

import { isNull } from "drizzle-orm"
import { db } from "@yomi/db"
import { user } from "../src/auth-schema.js"
import { ensureLeaderboardHandle } from "../src/services/streaks.js"

const rows = await db
  .select({ id: user.id, email: user.email })
  .from(user)
  .where(isNull(user.leaderboardHandle))

console.log(`backfilling handles for ${rows.length} user(s)...`)

for (const row of rows) {
  const handle = await ensureLeaderboardHandle(row.id)
  console.log(`  ${row.email} -> ${handle}`)
}

console.log("done")
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/backend && bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/scripts/backfill-leaderboard-handles.ts
git commit -m "chore: add one-off backfill script for missing leaderboard handles"
```

- [ ] **Step 4 (manual, run once against the real database after deploy):**

```bash
cd apps/backend && bun run db:migrate
bun scripts/backfill-leaderboard-handles.ts
```

Per this repo's convention (`specs/archive/superpowers/plans/*` history and the "migrations are a manual step" precedent), migrations don't run automatically on deploy — run `db:migrate` after the code ships, then the backfill script once. Also confirm with the user before this step: **the `avatars/` S3 prefix needs to be excluded from the bucket's 30-day lifecycle rule** (AWS console/IaC change, outside this repo) before real avatar uploads are used — flag this explicitly rather than assuming it's done.

---

### Task 6: Frontend — `StreaksManager.tsx` redesign

**Files:**
- Modify: `apps/landing/src/components/dashboard/StreaksManager.tsx`

**Interfaces:**
- Consumes: `GET /api/streaks/me` (now includes `plan`), `GET /api/streaks/leaderboard` (entries now include `plan`), `POST /api/streaks/opt-in` (unchanged wire shape). `DashboardTab` type from `./SettingsMenu`.
- Produces: `StreaksManager({ token, onNavigate }: { token: string; onNavigate: (tab: DashboardTab) => void })` — the `onNavigate` prop is new and required; Task 7 updates the call site in `dashboard/page.tsx` to pass it.

- [ ] **Step 1: Replace the full file**

Replace the entire contents of `apps/landing/src/components/dashboard/StreaksManager.tsx` with:

```tsx
"use client"

import { useCallback, useEffect, useState } from "react"
import { Crown, Cuboid, Flame, Loader2, Trophy, User } from "lucide-react"
import type { DashboardTab } from "./SettingsMenu"

type StreakStats = {
  currentStreak: number
  longestStreak: number
  totalMessagesSent: number
  leaderboardOptIn: boolean
  leaderboardHandle: string | null
  leaderboardShowPhoto: boolean
  avatarUrl: string | null
  plan: string
}

type LeaderboardEntry = {
  rank: number
  handle: string
  totalMessagesSent: number
  isYou: boolean
  avatarUrl: string | null
  plan: string
}

type Leaderboard = {
  entries: LeaderboardEntry[]
  yourRank: number | null
}

function Avatar({ url, size = 24 }: { url: string | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (!url || broken) {
    return (
      <div
        style={{ width: size, height: size }}
        className="grid shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
      >
        <User size={size * 0.6} />
      </div>
    )
  }
  return (
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full object-cover"
    />
  )
}

const PLAN_BADGE: Record<string, { label: string; icon: typeof Crown; className: string }> = {
  pro: { label: "PRO", icon: Crown, className: "bg-primary/15 text-primary" },
  max: { label: "MAX", icon: Cuboid, className: "bg-violet-500/15 text-violet-400" },
}

function PlanBadge({ plan }: { plan: string }) {
  const badge = PLAN_BADGE[plan]
  if (!badge) return null
  const Icon = badge.icon
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}
    >
      <Icon size={9} />
      {badge.label}
    </span>
  )
}

function RankMarker({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy size={16} className="shrink-0 text-yellow-400" />
  return <span className="w-4 shrink-0 text-right tabular-nums text-muted-foreground">{rank}</span>
}

function LeaderboardRow({
  rank,
  handle,
  plan,
  avatarUrl,
  totalMessagesSent,
  topScore,
  isYou,
}: {
  rank: number
  handle: string | null
  plan: string
  avatarUrl: string | null
  totalMessagesSent: number
  topScore: number
  isYou: boolean
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg px-2 py-2 text-sm ${isYou ? "bg-primary/10" : ""}`}
    >
      <RankMarker rank={rank} />
      <Avatar url={avatarUrl} size={26} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-foreground">{handle}</span>
          <PlanBadge plan={plan} />
          {isYou && <span className="shrink-0 text-xs text-muted-foreground">(you)</span>}
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.max(4, (totalMessagesSent / topScore) * 100)}%` }}
          />
        </div>
      </div>
      <span className="shrink-0 tabular-nums text-muted-foreground">{totalMessagesSent}</span>
    </div>
  )
}

export function StreaksManager({
  token,
  onNavigate,
}: {
  token: string
  onNavigate: (tab: DashboardTab) => void
}) {
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
      if (!leaderboardRes.ok)
        throw new Error(`Couldn't load leaderboard (${leaderboardRes.status})`)
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

  async function toggleVisibility() {
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
      const result = (await res.json()) as { leaderboardOptIn: boolean }
      setStats((prev) => (prev ? { ...prev, leaderboardOptIn: result.leaderboardOptIn } : prev))
      const leaderboardRes = await fetch("/api/streaks/leaderboard", { headers: auth })
      if (leaderboardRes.ok) setLeaderboard((await leaderboardRes.json()) as Leaderboard)
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

  const topScore = Math.max(
    1,
    leaderboard.entries[0]?.totalMessagesSent ?? 1,
    stats.totalMessagesSent,
  )
  const viewerInList = leaderboard.entries.some((e) => e.isYou)

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
          <div className="flex items-center gap-3">
            <Avatar url={stats.leaderboardShowPhoto ? stats.avatarUrl : null} size={32} />
            <div>
              <p className="text-sm text-foreground">
                {stats.leaderboardOptIn
                  ? "You're on the leaderboard"
                  : "You're hidden from the leaderboard"}
              </p>
              <p className="text-xs text-muted-foreground">
                {stats.leaderboardOptIn
                  ? `Visible as "${stats.leaderboardHandle}".`
                  : "Nobody can see you on the leaderboard right now."}
              </p>
            </div>
          </div>
          <button
            onClick={toggleVisibility}
            disabled={toggling}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 disabled:opacity-50"
          >
            {toggling ? (
              <Loader2 size={14} className="animate-spin" />
            ) : stats.leaderboardOptIn ? (
              "Hide me"
            ) : (
              "Show me"
            )}
          </button>
        </div>
        {actionError && <p className="mt-2 text-xs text-destructive">{actionError}</p>}

        <button
          type="button"
          onClick={() => onNavigate("profile")}
          className="mt-3 text-xs font-medium text-primary hover:underline"
        >
          Edit profile →
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <Trophy size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Leaderboard</h3>
        </div>
        {leaderboard.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody&apos;s here yet.</p>
        ) : (
          <div className="space-y-1.5">
            {leaderboard.entries.map((entry) => (
              <LeaderboardRow
                key={entry.rank}
                rank={entry.rank}
                handle={entry.handle}
                plan={entry.plan}
                avatarUrl={entry.avatarUrl}
                totalMessagesSent={entry.totalMessagesSent}
                topScore={topScore}
                isYou={entry.isYou}
              />
            ))}
            {leaderboard.yourRank !== null && !viewerInList && (
              <LeaderboardRow
                rank={leaderboard.yourRank}
                handle={stats.leaderboardHandle}
                plan={stats.plan}
                avatarUrl={stats.leaderboardShowPhoto ? stats.avatarUrl : null}
                totalMessagesSent={stats.totalMessagesSent}
                topScore={topScore}
                isYou
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd apps/landing && bun run typecheck`
Expected: errors at the `StreaksManager` call site in `dashboard/page.tsx` (missing `onNavigate` prop) — expected at this point, fixed in Task 7.

- [ ] **Step 3: Commit**

```bash
git add apps/landing/src/components/dashboard/StreaksManager.tsx
git commit -m "feat: redesign leaderboard with plan badges, trophy, and progress bars"
```

---

### Task 7: Frontend — new `ProfileManager.tsx`, wire into dashboard

**Files:**
- Create: `apps/landing/src/components/dashboard/ProfileManager.tsx`
- Modify: `apps/landing/src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /api/user/me`, `GET /api/streaks/me`, `PATCH /api/user/profile`, `POST /api/user/handle`, `POST /api/user/show-photo`, `POST /api/user/avatar` (all from Tasks 2/4). `PLANS` from `@/lib/plans`.
- Produces: `ProfileManager({ token }: { token: string })`, a self-contained component like `StreaksManager`/`ReferralsManager`.

- [ ] **Step 1: Create `ProfileManager.tsx`**

```tsx
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, Check, Loader2, User } from "lucide-react"
import { PLANS } from "@/lib/plans"

type ProfileData = {
  name: string
  email: string
  plan: string
}

type StreakProfileFields = {
  leaderboardHandle: string | null
  leaderboardShowPhoto: boolean
  avatarUrl: string | null
}

function Avatar({ url, size = 64 }: { url: string | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (!url || broken) {
    return (
      <div
        style={{ width: size, height: size }}
        className="grid shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
      >
        <User size={size * 0.5} />
      </div>
    )
  }
  return (
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full object-cover"
    />
  )
}

export function ProfileManager({ token }: { token: string }) {
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [streakFields, setStreakFields] = useState<StreakProfileFields | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [nameInput, setNameInput] = useState("")
  const [savingName, setSavingName] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)
  const [nameError, setNameError] = useState("")

  const [handleInput, setHandleInput] = useState("")
  const [savingHandle, setSavingHandle] = useState(false)
  const [handleSaved, setHandleSaved] = useState(false)
  const [handleError, setHandleError] = useState("")

  const [savingPhoto, setSavingPhoto] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarError, setAvatarError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const auth = { Authorization: `Bearer ${token}` }

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [profileRes, streaksRes] = await Promise.all([
        fetch("/api/user/me", { headers: auth }),
        fetch("/api/streaks/me", { headers: auth }),
      ])
      if (!profileRes.ok) throw new Error(`Couldn't load profile (${profileRes.status})`)
      if (!streaksRes.ok) throw new Error(`Couldn't load profile (${streaksRes.status})`)
      const profileData = (await profileRes.json()) as ProfileData
      const streaksData = (await streaksRes.json()) as StreakProfileFields
      setProfile(profileData)
      setStreakFields(streaksData)
      setNameInput(profileData.name)
      setHandleInput(streaksData.leaderboardHandle ?? "")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load profile")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function saveName() {
    if (savingName || !nameInput.trim()) return
    setSavingName(true)
    setNameError("")
    setNameSaved(false)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameInput }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; name?: string }
      if (!res.ok) throw new Error(data.error ?? "Couldn't save that name")
      setProfile((prev) => (prev ? { ...prev, name: data.name ?? prev.name } : prev))
      setNameSaved(true)
      setTimeout(() => setNameSaved(false), 2000)
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Couldn't save that name")
    } finally {
      setSavingName(false)
    }
  }

  async function saveHandle() {
    if (savingHandle || !handleInput.trim()) return
    setSavingHandle(true)
    setHandleError("")
    setHandleSaved(false)
    try {
      const res = await fetch("/api/user/handle", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ handle: handleInput }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        leaderboardHandle?: string
      }
      if (!res.ok) throw new Error(data.error ?? "Couldn't save that handle")
      setStreakFields((prev) =>
        prev
          ? { ...prev, leaderboardHandle: data.leaderboardHandle ?? prev.leaderboardHandle }
          : prev,
      )
      setHandleSaved(true)
      setTimeout(() => setHandleSaved(false), 2000)
    } catch (err) {
      setHandleError(err instanceof Error ? err.message : "Couldn't save that handle")
    } finally {
      setSavingHandle(false)
    }
  }

  async function toggleShowPhoto() {
    if (!streakFields || savingPhoto) return
    setSavingPhoto(true)
    try {
      const res = await fetch("/api/user/show-photo", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ showPhoto: !streakFields.leaderboardShowPhoto }),
      })
      if (!res.ok) throw new Error(`Couldn't update photo setting (${res.status})`)
      const result = (await res.json()) as { leaderboardShowPhoto: boolean }
      setStreakFields((prev) =>
        prev ? { ...prev, leaderboardShowPhoto: result.leaderboardShowPhoto } : prev,
      )
    } catch {
      // best-effort — matches the same toggle's error handling in StreaksManager
    } finally {
      setSavingPhoto(false)
    }
  }

  async function uploadAvatar(file: File) {
    setUploadingAvatar(true)
    setAvatarError("")
    try {
      const res = await fetch("/api/user/avatar", {
        method: "POST",
        headers: { ...auth, "Content-Type": file.type },
        body: file,
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; avatarUrl?: string }
      if (!res.ok) throw new Error(data.error ?? "Couldn't upload that image")
      setStreakFields((prev) =>
        prev ? { ...prev, avatarUrl: data.avatarUrl ?? prev.avatarUrl } : prev,
      )
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Couldn't upload that image")
    } finally {
      setUploadingAvatar(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 flex justify-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !profile || !streakFields) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <p className="text-sm text-destructive">{error || "Couldn't load profile"}</p>
      </div>
    )
  }

  const currentPlan = PLANS.find((p) => p.key === profile.plan)
  const PlanIcon = currentPlan?.icon

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="relative shrink-0 rounded-full disabled:opacity-50"
            aria-label="Upload profile photo"
          >
            <Avatar url={streakFields.avatarUrl} size={64} />
            <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
              {uploadingAvatar ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Camera size={12} />
              )}
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void uploadAvatar(file)
              e.target.value = ""
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{profile.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{profile.email}</p>
          </div>
        </div>
        {avatarError && <p className="mt-2 text-xs text-destructive">{avatarError}</p>}

        <div className="mt-5 space-y-3 border-t border-border pt-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
            <div className="flex items-center gap-2">
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Your name"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary/60"
                maxLength={80}
              />
              <button
                onClick={saveName}
                disabled={savingName || !nameInput.trim()}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 disabled:opacity-50"
              >
                {savingName ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : nameSaved ? (
                  <Check size={13} />
                ) : null}
                {nameSaved ? "Saved" : "Save"}
              </button>
            </div>
            {nameError && <p className="mt-1.5 text-xs text-destructive">{nameError}</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Username
            </label>
            <div className="flex items-center gap-2">
              <input
                value={handleInput}
                onChange={(e) => setHandleInput(e.target.value)}
                placeholder="pick a username"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary/60"
                maxLength={24}
              />
              <button
                onClick={saveHandle}
                disabled={savingHandle || !handleInput.trim()}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 disabled:opacity-50"
              >
                {savingHandle ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : handleSaved ? (
                  <Check size={13} />
                ) : null}
                {handleSaved ? "Saved" : "Save"}
              </button>
            </div>
            {handleError && <p className="mt-1.5 text-xs text-destructive">{handleError}</p>}
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-foreground">
              Show my profile photo on the leaderboard
            </span>
            <button
              type="button"
              onClick={toggleShowPhoto}
              disabled={savingPhoto}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                streakFields.leaderboardShowPhoto ? "bg-primary" : "bg-muted"
              }`}
              aria-pressed={streakFields.leaderboardShowPhoto}
              aria-label="Toggle showing your profile photo on the leaderboard"
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-background transition-transform ${
                  streakFields.leaderboardShowPhoto ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          Your plan
        </p>
        <div className="flex items-center gap-3">
          {PlanIcon && <PlanIcon size={20} className="text-primary" />}
          <div>
            <p className="text-sm font-medium text-foreground">{currentPlan?.name ?? profile.plan}</p>
            <p className="text-xs text-muted-foreground">{currentPlan?.desc}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `dashboard/page.tsx`**

Add the import near the other dashboard component imports (after the `StreaksManager` import):

```ts
import { ProfileManager } from "@/components/dashboard/ProfileManager"
```

Replace the static profile card (currently the `<div className="rounded-2xl border border-border bg-card p-5 sm:p-6 flex items-center justify-between gap-3">...</div>` block right after `{activeTab === "profile" && (`) with:

```tsx
{activeTab === "profile" && (
  <>
    <ProfileManager token={session.session.token} />

    {/* Welcome banner — shown once after signup */}
```

(keep everything from the `{showWelcome && (` line onward exactly as it is today — only the static name/email card above it is replaced).

Update the `StreaksManager` call site to pass the new `onNavigate` prop:

```tsx
<StreaksManager token={session.session.token} onNavigate={setActiveTab} />
```

- [ ] **Step 3: Verify it typechecks**

Run: `cd apps/landing && bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Run the full frontend lint/test suite**

Run: `cd apps/landing && bun run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/landing/src/components/dashboard/ProfileManager.tsx apps/landing/src/app/dashboard/page.tsx
git commit -m "feat: add profile page with avatar upload, username, and plan display"
```

---

### Task 8: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run: `cd apps/backend && bun run test && bun run typecheck`
Expected: all green.

- [ ] **Step 2: Run the full landing suite**

Run: `cd apps/landing && bun run typecheck && bun run lint`
Expected: all green.

- [ ] **Step 3: Start the dev servers and check the dashboard in a browser**

Run: `bun run dev` from the repo root (or the per-app dev commands if that's not wired up).

In the browser:
- Open the dashboard, go to the Streaks tab. Confirm the leaderboard shows entries with rank markers (trophy for #1), avatars, plan badges where applicable, progress bars, and message counts.
- Confirm the "Hide me" / "Show me" toggle flips correctly and the leaderboard list updates after toggling.
- Click "Edit profile →" and confirm it switches to the Profile tab.
- On the Profile tab: confirm name defaults to the Google account name, upload an avatar image and confirm it appears immediately, save a new username and confirm it's reflected, toggle "Show my profile photo," and confirm the current plan is displayed correctly.
- Confirm avatar images render correctly in both the Profile tab and the Streaks leaderboard (this exercises the new unauthenticated `GET /api/user/avatar/:userId` route end-to-end).

- [ ] **Step 4: Flag the outstanding manual prerequisite to the user**

Confirm whether the S3 bucket's 30-day lifecycle rule has been updated to exclude the `avatars/` prefix. If not done yet, tell the user explicitly that uploaded avatars will currently expire after 30 days until that AWS-side change is made.
