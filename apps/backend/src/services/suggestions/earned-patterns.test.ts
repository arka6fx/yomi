import { describe, expect, it, mock, beforeEach } from "bun:test"

type Row = { connectorIds: string[]; createdAt: Date }
const state = { rows: [] as Row[] }

mock.module("@yomi/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve(state.rows) }) }) },
  aiUsageEvents: { userId: {}, createdAt: {}, connectorIds: {} },
}))

const { earnedPatterns } = await import("./earned-patterns.js")

const NOW = new Date("2026-07-17T12:00:00.000Z")

// build an event `daysAgo` before NOW at UTC `hour`, for one or more connectors
function ev(connectors: string | string[], daysAgo: number, hour: number): Row {
  const d = new Date(NOW)
  d.setUTCDate(d.getUTCDate() - daysAgo)
  d.setUTCHours(hour, 0, 0, 0)
  return { connectorIds: Array.isArray(connectors) ? connectors : [connectors], createdAt: d }
}

beforeEach(() => {
  state.rows = []
})

describe("earnedPatterns", () => {
  it("qualifies a connector seen on >=3 distinct days in one bucket", async () => {
    state.rows = [ev("github", 1, 8), ev("github", 3, 8), ev("github", 5, 8)]
    const patterns = await earnedPatterns("u1", NOW)
    expect(patterns).toEqual([{ connector: "github", timeBucket: "morning", distinctDays: 3 }])
  })

  it("does not qualify a connector seen on fewer than 3 distinct days", async () => {
    state.rows = [ev("github", 1, 8), ev("github", 3, 8)]
    const patterns = await earnedPatterns("u1", NOW)
    expect(patterns).toEqual([])
  })

  it("counts distinct days, not raw events — a single busy day never qualifies", async () => {
    state.rows = [ev("github", 2, 8), ev("github", 2, 9), ev("github", 2, 10), ev("github", 2, 11)]
    const patterns = await earnedPatterns("u1", NOW)
    expect(patterns).toEqual([])
  })

  it("excludes events outside the 30-day lookback window", async () => {
    // two in-window days + two out-of-window days: only 2 count, so no qualify
    state.rows = [ev("github", 1, 8), ev("github", 3, 8), ev("github", 33, 8), ev("github", 40, 8)]
    const patterns = await earnedPatterns("u1", NOW)
    expect(patterns).toEqual([])
  })

  it("does not accumulate distinct days across buckets — earning is per (connector, bucket)", async () => {
    // 3 distinct days but one per day-part: each bucket sees only 1 day, none qualify
    state.rows = [ev("github", 1, 8), ev("github", 3, 14), ev("github", 5, 20)]
    const patterns = await earnedPatterns("u1", NOW)
    expect(patterns).toEqual([])
  })

  it("clusters events into the correct day-part bucket", async () => {
    state.rows = [
      ev("github", 1, 8), // morning
      ev("github", 3, 8),
      ev("github", 5, 8),
      ev("github", 1, 14), // afternoon
      ev("github", 3, 14),
      ev("github", 5, 14),
      ev("github", 1, 20), // evening
      ev("github", 3, 20),
      ev("github", 5, 20),
    ]
    const patterns = await earnedPatterns("u1", NOW)
    const buckets = patterns.map((p) => p.timeBucket).sort()
    expect(buckets).toEqual(["afternoon", "evening", "morning"])
    expect(patterns.every((p) => p.distinctDays === 3)).toBe(true)
  })

  it("earns per connector when an event touches multiple connectors", async () => {
    state.rows = [
      ev(["github", "google"], 1, 8),
      ev(["github", "google"], 3, 8),
      ev(["github", "google"], 5, 8),
    ]
    const patterns = await earnedPatterns("u1", NOW)
    const connectors = patterns.map((p) => p.connector).sort()
    expect(connectors).toEqual(["github", "google"])
  })
})
