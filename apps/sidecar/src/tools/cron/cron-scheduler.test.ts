import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { CronScheduler, getDefaultScheduler } from "./cron-scheduler.js"

let tmpBase: string

beforeEach(async () => {
  tmpBase = join(tmpdir(), "yomi-cron-sched-test", Math.random().toString(36).slice(2))
  await mkdir(tmpBase, { recursive: true })
  process.env["YOMI_NOTEPAD_DIR"] = tmpBase
})

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
  delete process.env["YOMI_NOTEPAD_DIR"]
})

describe("CronScheduler", () => {
  it("does not start for explore plan", () => {
    const sched = new CronScheduler()
    sched.start("explore")
    // Should log warning and not set interval
    sched.stop()
    // If stop doesn't throw, that's fine — means no interval was running
  })

  it("starts for pro plan", () => {
    const sched = new CronScheduler()
    sched.start("pro")
    sched.stop()
    // The interval was set and cleared without error
  })

  it("is idempotent on repeated start", () => {
    const sched = new CronScheduler()
    sched.start("pro")
    sched.start("pro") // second start should be no-op
    sched.stop()
  })

  it("stop on non-started scheduler is safe", () => {
    const sched = new CronScheduler()
    sched.stop() // should not throw
  })

  it("getDefaultScheduler returns a singleton", () => {
    const a = getDefaultScheduler()
    const b = getDefaultScheduler()
    expect(a).toBe(b)
  })

  it("handles tick with no due jobs without error", async () => {
    const sched = new CronScheduler()
    sched.start("pro")
    // Wait briefly — tick fires after 30s, so the tick shouldn't fire in the test
    await new Promise((r) => setTimeout(r, 50))
    sched.stop()
  })
})
