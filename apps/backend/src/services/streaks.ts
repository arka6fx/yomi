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
