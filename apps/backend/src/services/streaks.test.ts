import { beforeEach, describe, expect, it, mock } from "bun:test"

let selectQueue: unknown[][] = []
let updateSets: Record<string, unknown>[] = []
// Queue of behaviors for successive db.update(...).set(...).where(...) calls. When empty,
// updates resolve normally. Push an Error to make the next update call reject with it.
let updateBehaviors: (Error | undefined)[] = []

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
      return {
        where: () => {
          const behavior = updateBehaviors.shift()
          if (behavior) return Promise.reject(behavior)
          return Promise.resolve()
        },
      }
    },
  }),
}

mock.module("@yomi/db", () => ({ db: fakeDb }))
mock.module("../auth-schema.js", () => ({ user: {} }))

const {
  recordDailyActivity,
  getStreakStats,
  setLeaderboardOptIn,
  updateLeaderboardHandle,
  setLeaderboardShowPhoto,
  getLeaderboard,
} = await import("./streaks.js")

beforeEach(() => {
  selectQueue = []
  updateSets = []
  updateBehaviors = []
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
  it("returns the persisted stats for a user, including their avatar", async () => {
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
      leaderboardShowPhoto: true,
      avatarUrl: null,
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

  it("retries with a freshly generated handle when the first candidate collides", async () => {
    selectQueue = [[{ leaderboardHandle: null }]]
    updateBehaviors = [
      new Error('duplicate key value violates unique constraint "user_leaderboard_handle_unique"'),
    ]
    const result = await setLeaderboardOptIn("user_1", true)
    expect(result.leaderboardOptIn).toBe(true)
    expect(result.leaderboardHandle).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{4}$/)
    expect(updateSets).toHaveLength(2)
    const firstCandidate = updateSets[0]?.leaderboardHandle
    const secondCandidate = updateSets[1]?.leaderboardHandle
    expect(secondCandidate).toBe(result.leaderboardHandle)
    expect(secondCandidate).not.toBe(firstCandidate)
  })
})

describe("updateLeaderboardHandle", () => {
  it("accepts a valid custom handle", async () => {
    const result = await updateLeaderboardHandle("user_1", "ArkaG")
    expect(result).toEqual({ ok: true, leaderboardHandle: "arkag" })
    expect(updateSets[0]).toEqual({ leaderboardHandle: "arkag" })
  })

  it("rejects a handle that's too short or has invalid characters", async () => {
    const tooShort = await updateLeaderboardHandle("user_1", "ab")
    expect(tooShort.ok).toBe(false)
    const badChars = await updateLeaderboardHandle("user_1", "arka_garai!")
    expect(badChars.ok).toBe(false)
    expect(updateSets).toHaveLength(0)
  })

  it("returns a friendly error when the handle is already taken", async () => {
    updateBehaviors = [
      new Error('duplicate key value violates unique constraint "user_leaderboard_handle_unique"'),
    ]
    const result = await updateLeaderboardHandle("user_1", "taken-handle")
    expect(result).toEqual({ ok: false, error: "That handle is already taken — try another." })
  })
})

describe("setLeaderboardShowPhoto", () => {
  it("persists the photo-visibility preference", async () => {
    const result = await setLeaderboardShowPhoto("user_1", false)
    expect(result).toEqual({ leaderboardShowPhoto: false })
    expect(updateSets[0]).toEqual({ leaderboardShowPhoto: false })
  })
})

describe("getLeaderboard", () => {
  it("ranks opted-in users by totalMessagesSent descending, flags the viewer, and includes avatars", async () => {
    selectQueue = [
      [
        {
          id: "user_2",
          handle: "swift-otter-11aa",
          totalMessagesSent: 50,
          image: "https://lh3.googleusercontent.com/a/other.jpg",
          leaderboardShowPhoto: true,
        },
        {
          id: "user_1",
          handle: "quiet-falcon-3f2a",
          totalMessagesSent: 30,
          image: "https://lh3.googleusercontent.com/a/mine.jpg",
          leaderboardShowPhoto: false,
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
      },
      {
        rank: 2,
        handle: "quiet-falcon-3f2a",
        totalMessagesSent: 30,
        isYou: true,
        avatarUrl: null,
      },
    ])
    expect(result.yourRank).toBe(2)
  })

  it("computes yourRank for an opted-in viewer outside the visible top N", async () => {
    selectQueue = [
      [
        {
          id: "user_2",
          handle: "swift-otter-11aa",
          totalMessagesSent: 50,
          image: null,
          leaderboardShowPhoto: true,
        },
      ],
      [{ leaderboardOptIn: true, totalMessagesSent: 10 }],
      [{ count: 4 }],
    ]
    const result = await getLeaderboard("user_1")
    expect(result.entries.every((e) => !e.isYou)).toBe(true)
    expect(result.yourRank).toBe(5)
  })

  it("returns yourRank null for a non-opted-in viewer outside the top N", async () => {
    selectQueue = [
      [
        {
          id: "user_2",
          handle: "swift-otter-11aa",
          totalMessagesSent: 50,
          image: null,
          leaderboardShowPhoto: true,
        },
      ],
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
