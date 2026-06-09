import { describe, expect, it } from "bun:test"
import {
  cronLimitForPlan,
  isCronAllowed,
  checkCronAccess,
  validateScheduleInput,
  CRON_LIMITS,
  MIN_INTERVAL_SECONDS,
} from "./cron-types.js"

describe("cronLimitForPlan", () => {
  it("returns 0 for undefined plan", () => {
    expect(cronLimitForPlan(undefined)).toBe(0)
  })

  it("returns 0 for explore plan", () => {
    expect(cronLimitForPlan("explore")).toBe(0)
  })

  it("returns 5 for pro plan", () => {
    expect(cronLimitForPlan("pro")).toBe(5)
  })

  it("returns 20 for max plan", () => {
    expect(cronLimitForPlan("max")).toBe(20)
  })

  it("is case-insensitive", () => {
    expect(cronLimitForPlan("Pro")).toBe(5)
    expect(cronLimitForPlan("MAX")).toBe(20)
    expect(cronLimitForPlan("EXPLORE")).toBe(0)
  })

  it("returns 0 for unknown plan", () => {
    expect(cronLimitForPlan("free")).toBe(0)
  })
})

describe("isCronAllowed", () => {
  it("returns false for explore", () => {
    expect(isCronAllowed("explore")).toBe(false)
  })

  it("returns true for pro", () => {
    expect(isCronAllowed("pro")).toBe(true)
  })

  it("returns true for max", () => {
    expect(isCronAllowed("max")).toBe(true)
  })
})

describe("checkCronAccess", () => {
  it("rejects explore plan for any action", () => {
    const r = checkCronAccess("explore", "create", 0)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("Pro feature")
  })

  it("allows create when under limit", () => {
    const r = checkCronAccess("pro", "create", 3)
    expect(r.ok).toBe(true)
  })

  it("rejects create when at limit", () => {
    const r = checkCronAccess("pro", "create", 5)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("limit reached")
  })

  it("allows create for max under limit", () => {
    const r = checkCronAccess("max", "create", 10)
    expect(r.ok).toBe(true)
  })

  it("rejects create for max at limit", () => {
    const r = checkCronAccess("max", "create", 20)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("limit reached")
  })

  it("allows non-create actions regardless of count", () => {
    expect(checkCronAccess("pro", "list", 99).ok).toBe(true)
    expect(checkCronAccess("pro", "update", 99).ok).toBe(true)
    expect(checkCronAccess("pro", "delete", 99).ok).toBe(true)
  })
})

describe("validateScheduleInput", () => {
  it("rejects empty input", () => {
    const r = validateScheduleInput("")
    expect(r.ok).toBe(false)
    expect(r.error).toContain("required")
  })

  it("rejects non-string input", () => {
    const r = validateScheduleInput(null as unknown as string)
    expect(r.ok).toBe(false)
  })

  it("accepts duration format: 30m", () => {
    const r = validateScheduleInput("30m")
    expect(r.ok).toBe(true)
    expect(r.scheduleType).toBe("duration")
  })

  it("accepts duration format: 2h", () => {
    const r = validateScheduleInput("2h")
    expect(r.ok).toBe(true)
    expect(r.scheduleType).toBe("duration")
  })

  it("accepts duration format: 1d", () => {
    const r = validateScheduleInput("1d")
    expect(r.ok).toBe(true)
    expect(r.scheduleType).toBe("duration")
  })

  it("rejects zero-minute duration", () => {
    const r = validateScheduleInput("0m")
    expect(r.ok).toBe(false)
  })

  it("rejects invalid duration", () => {
    const r = validateScheduleInput("30x")
    expect(r.ok).toBe(false)
  })

  it("accepts cron expression", () => {
    const r = validateScheduleInput("0 9 * * *")
    expect(r.ok).toBe(true)
    expect(r.scheduleType).toBe("cron")
  })

  it("accepts 5-field cron expression", () => {
    const r = validateScheduleInput("*/30 * * * *")
    expect(r.ok).toBe(true)
    expect(r.scheduleType).toBe("cron")
  })

  it("accepts ISO timestamp", () => {
    const r = validateScheduleInput("2026-06-15T09:00:00Z")
    expect(r.ok).toBe(true)
    expect(r.scheduleType).toBe("iso")
  })

  it("accepts ISO timestamp with offset", () => {
    const r = validateScheduleInput("2026-06-15T09:00:00+05:30")
    expect(r.ok).toBe(true)
    expect(r.scheduleType).toBe("iso")
  })

  it("rejects invalid ISO timestamp", () => {
    const r = validateScheduleInput("2026-13-01T99:99:99Z")
    expect(r.ok).toBe(false)
  })

  it("accepts phrase: every monday 9am", () => {
    const r = validateScheduleInput("every monday 9am")
    expect(r.ok).toBe(true)
    expect(r.scheduleType).toBe("phrase")
  })

  it("accepts phrase: every 2h", () => {
    const r = validateScheduleInput("every 2h")
    expect(r.ok).toBe(true)
    expect(r.scheduleType).toBe("phrase")
  })

  it("rejects unrecognised format", () => {
    const r = validateScheduleInput("nonsense")
    expect(r.ok).toBe(false)
    expect(r.error).toContain("unrecognised")
  })
})
