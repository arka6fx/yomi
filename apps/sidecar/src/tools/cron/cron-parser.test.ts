import { describe, expect, it } from "bun:test"
import { parseDurationMs, phraseToCron, nextFireTime, isJobDue, getDueJobs } from "./cron-parser.js"
import type { CronJob } from "./cron-types.js"

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "test-job",
    schedule: "30m",
    scheduleType: "duration",
    prompt: "test prompt",
    enabled: true,
    oneShot: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastRunAt: null,
    lastRunStatus: null,
    runCount: 0,
    ...overrides,
  }
}

describe("parseDurationMs", () => {
  it("parses minutes", () => {
    expect(parseDurationMs("30m")).toBe(30 * 60_000)
  })

  it("parses hours", () => {
    expect(parseDurationMs("2h")).toBe(2 * 3600_000)
  })

  it("parses days", () => {
    expect(parseDurationMs("1d")).toBe(86_400_000)
  })

  it("returns null for invalid format", () => {
    expect(parseDurationMs("30x")).toBe(null)
  })

  it("returns null for empty string", () => {
    expect(parseDurationMs("")).toBe(null)
  })

  it("is case-insensitive", () => {
    expect(parseDurationMs("30M")).toBe(30 * 60_000)
    expect(parseDurationMs("2H")).toBe(2 * 3600_000)
    expect(parseDurationMs("1D")).toBe(86_400_000)
  })
})

describe("phraseToCron", () => {
  it('converts "every monday 9am"', () => {
    expect(phraseToCron("every monday 9am")).toBe("0 9 * * 1")
  })

  it('converts "every friday 17" (5pm)', () => {
    expect(phraseToCron("every friday 17")).toBe("0 17 * * 5")
  })

  it("converts every 2h", () => {
    expect(phraseToCron("every 2h")).toBe("0 */2 * * *")
  })

  it("converts every 3 hours", () => {
    expect(phraseToCron("every 3 hours")).toBe("0 */3 * * *")
  })

  it('converts "every day 9am"', () => {
    expect(phraseToCron("every day 9am")).toBe("0 9 * * *")
  })

  it('converts "every hour"', () => {
    expect(phraseToCron("every hour")).toBe("0 * * * *")
  })

  it('converts "every weekday 10am"', () => {
    expect(phraseToCron("every weekday 10am")).toBe("0 10 * * 1-5")
  })

  it("returns null for unrecognised phrase", () => {
    expect(phraseToCron("do something")).toBe(null)
  })
})

describe("nextFireTime — duration", () => {
  it("returns now if never run", () => {
    const job = makeJob({ schedule: "30m", scheduleType: "duration" })
    const next = nextFireTime(job)
    expect(next).not.toBeNull()
    expect(next!.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it("returns lastRunAt + interval if previously run", () => {
    const lastRun = new Date("2026-01-01T12:00:00Z")
    const job = makeJob({
      schedule: "30m",
      scheduleType: "duration",
      lastRunAt: lastRun.toISOString(),
    })
    const next = nextFireTime(job)
    expect(next).not.toBeNull()
    expect(next!.getTime()).toBe(lastRun.getTime() + 30 * 60_000)
  })

  it("returns null for invalid duration", () => {
    const job = makeJob({
      schedule: "30x",
      scheduleType: "duration",
      lastRunAt: new Date().toISOString(),
    })
    expect(nextFireTime(job)).toBeNull()
  })
})

describe("nextFireTime — iso (one-shot)", () => {
  it("returns the target time if never run", () => {
    const target = new Date(Date.now() + 3600_000) // 1 hour from now
    const job = makeJob({
      schedule: target.toISOString(),
      scheduleType: "iso",
    })
    const next = nextFireTime(job)
    expect(next).not.toBeNull()
    expect(next!.getTime()).toBe(target.getTime())
  })

  it("returns null if already run", () => {
    const job = makeJob({
      schedule: "2026-01-01T00:00:00.000Z",
      scheduleType: "iso",
      lastRunAt: "2026-01-01T01:00:00.000Z",
    })
    expect(nextFireTime(job)).toBeNull()
  })

  it("returns null for invalid ISO", () => {
    const job = makeJob({
      schedule: "not-a-date",
      scheduleType: "iso",
    })
    expect(nextFireTime(job)).toBeNull()
  })
})

describe("nextFireTime — cron expression", () => {
  it("computes next fire time for a cron expression", () => {
    const job = makeJob({
      schedule: "0 9 * * *",
      scheduleType: "cron",
      lastRunAt: "2026-01-01T00:00:00Z",
    })
    const next = nextFireTime(job)
    expect(next).not.toBeNull()
    // Next 09:00 after Jan 1 midnight
    expect(next!.getUTCHours()).toBe(9)
  })

  it("returns null for invalid cron expression", () => {
    const job = makeJob({
      schedule: "invalid cron",
      scheduleType: "cron",
    })
    expect(nextFireTime(job)).toBeNull()
  })
})

describe("nextFireTime — phrase", () => {
  it("converts phrase and computes next fire time", () => {
    const job = makeJob({
      schedule: "every hour",
      scheduleType: "phrase",
      lastRunAt: new Date(0).toISOString(),
    })
    const next = nextFireTime(job)
    expect(next).not.toBeNull()
  })

  it("returns null for unrecognised phrase", () => {
    const job = makeJob({
      schedule: "garbage in",
      scheduleType: "phrase",
    })
    expect(nextFireTime(job)).toBeNull()
  })
})

describe("nextFireTime — disabled job", () => {
  it("returns null for disabled jobs", () => {
    const job = makeJob({ enabled: false })
    expect(nextFireTime(job)).toBeNull()
  })
})

describe("isJobDue", () => {
  it("returns true when next fire is in the past", () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const job = makeJob({
      scheduleType: "iso",
      schedule: past,
    })
    // Force the "now" to be after the ISO target
    const now = new Date(Date.now() + 10_000)
    expect(isJobDue(job, now)).toBe(true)
  })

  it("returns false when next fire is in the future", () => {
    const future = new Date(Date.now() + 3600_000).toISOString()
    const job = makeJob({
      scheduleType: "iso",
      schedule: future,
    })
    expect(isJobDue(job)).toBe(false)
  })

  it("returns false for disabled jobs", () => {
    const job = makeJob({ enabled: false })
    expect(isJobDue(job)).toBe(false)
  })
})

describe("getDueJobs", () => {
  it("returns only due jobs", () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const future = new Date(Date.now() + 3600_000).toISOString()

    const jobs: Record<string, CronJob> = {
      due: makeJob({ id: "due", scheduleType: "iso", schedule: past }),
      notDue: makeJob({ id: "notDue", scheduleType: "iso", schedule: future }),
    }

    const due = getDueJobs(jobs, new Date())
    expect(due).toHaveLength(1)
    expect(due[0]!.id).toBe("due")
  })

  it("returns empty when no jobs due", () => {
    const future = new Date(Date.now() + 3600_000).toISOString()
    const jobs: Record<string, CronJob> = {
      future: makeJob({ scheduleType: "iso", schedule: future }),
    }
    expect(getDueJobs(jobs, new Date())).toHaveLength(0)
  })

  it("returns empty for empty store", () => {
    expect(getDueJobs({})).toEqual([])
  })
})
