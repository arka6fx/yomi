// Cron scheduler — background tick loop that runs every 60s.
// Uses a file-based lock to prevent duplicate ticks across processes.
// Started from index.ts, shutdown on SIGINT/SIGTERM.

import { loadJobs, saveJobs, acquireTickLock, releaseTickLock } from "./cron-store.js"
import { getDueJobs } from "./cron-parser.js"
import { executeCronJob } from "./cron-executor.js"
import { checkCronAccess, MIN_INTERVAL_SECONDS } from "./cron-types.js"
import type { CronJob } from "./cron-types.js"

const TICK_INTERVAL_MS = 60_000
const MIN_INTERVAL_DEFAULT = 60 // seconds, fallback

export class CronScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private tickPromise: Promise<void> | null = null
  private running = false

  start(plan?: string): void {
    if (this.intervalId) return
    console.warn("[cron] scheduler starting")

    // Check entitlement at start
    const access = checkCronAccess(plan, "create", 0)
    if (!access.ok) {
      console.warn("[cron] scheduler not started:", access.reason)
      return
    }

    this.running = true
    // Fire first tick after 30s (gives the sidecar time to fully initialise)
    setTimeout(() => { void this.tick() }, 30_000)
    this.intervalId = setInterval(() => { void this.tick() }, TICK_INTERVAL_MS)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.running = false
  }

  private async tick(): Promise<void> {
    if (!this.running) return
    if (this.tickPromise) {
      // Previous tick still running — skip
      return
    }

    const acquired = await acquireTickLock()
    if (!acquired) return

    this.tickPromise = this.processTick()
    try {
      await this.tickPromise
    } finally {
      this.tickPromise = null
      await releaseTickLock()
    }
  }

  private async processTick(): Promise<void> {
    const jobs = await loadJobs()
    const due = getDueJobs(jobs, new Date())

    if (due.length === 0) return

    console.warn(`[cron] tick: ${due.length} job(s) due`)

    for (const job of due) {
      // Re-check entitlement per-job (plan could change between ticks)
      const plan = await getCurrentPlan(job)
      const intervalSec = MIN_INTERVAL_SECONDS[plan ?? "explore"] ?? MIN_INTERVAL_DEFAULT

      // Check minimum interval
      if (job.lastRunAt) {
        const elapsed = (Date.now() - Date.parse(job.lastRunAt)) / 1000
        if (elapsed < intervalSec) {
          console.warn(`[cron] job "${job.id}" skipped — minimum interval not elapsed`)
          continue
        }
      }

      // Check per-job plan limit
      const access = checkCronAccess(plan, "update", Object.keys(jobs).length)
      if (!access.ok) {
        console.warn(`[cron] job "${job.id}" skipped:`, access.reason)
        continue
      }

      console.warn(`[cron] executing job "${job.id}"`)
      const result = await executeCronJob(job)

      // Update job record
      jobs[job.id]!.lastRunAt = new Date().toISOString()
      jobs[job.id]!.lastRunStatus = result.ok ? "success" : "error"
      jobs[job.id]!.runCount++
      jobs[job.id]!.updatedAt = new Date().toISOString()

      // One-shot cleanup
      if (job.oneShot) {
        delete jobs[job.id]
      }
    }

    await saveJobs(jobs)
  }
}

// Reads the user's plan from memory subsystem or env. Falls back to
// environment variable so entitlement logic works without a full session.
async function getCurrentPlan(_job: CronJob): Promise<string | undefined> {
  return process.env["YOMI_PLAN"] ?? "pro"
}

// Module-level singleton, lazy-initialised at startup.
let defaultScheduler: CronScheduler | null = null

export function getDefaultScheduler(): CronScheduler {
  if (!defaultScheduler) defaultScheduler = new CronScheduler()
  return defaultScheduler
}
