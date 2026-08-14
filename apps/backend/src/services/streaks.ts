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
  return String(err).includes("user_leaderboard_handle_unique")
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
