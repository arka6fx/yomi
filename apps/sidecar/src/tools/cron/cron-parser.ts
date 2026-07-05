// Schedule parsing — translates schedule strings into fire times.
// Supports: duration ("30m", "2h", "1d"), cron expression ("0 9 * * *"),
// phrase ("every monday 9am"), and ISO timestamp.

import { CronExpressionParser } from "cron-parser"
import type { CronJob } from "./cron-types.js"

export function parseDurationMs(schedule: string): number | null {
  const match = schedule
    .trim()
    .toLowerCase()
    .match(/^(\d+)([mhd])$/)
  if (!match) return null
  const num = parseInt(match[1]!, 10)
  switch (match[2]) {
    case "m":
      return num * 60_000
    case "h":
      return num * 3600_000
    case "d":
      return num * 86_400_000
    default:
      return null
  }
}

export function phraseToCron(phrase: string): string | null {
  const p = phrase.toLowerCase().trim()

  const dayMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  }

  // "every monday 9am" → "0 9 * * 1"
  const dayMatch = p.match(
    /^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(\d{1,2})(?::(\d{2}))?\s*(?:am|pm)?$/i,
  )
  if (dayMatch) {
    const day = dayMap[dayMatch[1]!.toLowerCase()]
    const hour = parseInt(dayMatch[2]!, 10)
    if (day !== undefined && hour >= 0 && hour <= 23) {
      return `0 ${hour} * * ${day}`
    }
  }

  // "every 2h" → "0 */2 * * *"
  const everyN = p.match(/^every\s+(\d+)\s*(h|hour|hours)$/i)
  if (everyN) {
    const n = parseInt(everyN[1]!, 10)
    if (n >= 1) return `0 */${n} * * *`
  }

  // "every day 9am" → "0 9 * * *"
  const dayAt = p.match(/^every\s+day\s+(\d{1,2})(?::(\d{2}))?\s*(?:am|pm)?$/i)
  if (dayAt) {
    const hour = parseInt(dayAt[1]!, 10)
    if (hour >= 0 && hour <= 23) return `0 ${hour} * * *`
  }

  // "every hour" → "0 * * * *"
  if (/^every\s*(hour|1h|1\s*hour)$/i.test(p)) {
    return "0 * * * *"
  }

  // "every weekday 9am" → "0 9 * * 1-5"
  const weekday = p.match(/^every\s+weekday\s+(\d{1,2})(?::(\d{2}))?\s*(?:am|pm)?$/i)
  if (weekday) {
    const hour = parseInt(weekday[1]!, 10)
    if (hour >= 0 && hour <= 23) return `0 ${hour} * * 1-5`
  }

  return null
}

export function nextFireTime(job: CronJob): Date | null {
  if (!job.enabled) return null
  const now = Date.now()

  switch (job.scheduleType) {
    case "duration": {
      if (!job.lastRunAt) return new Date(now)
      const intervalMs = parseDurationMs(job.schedule)
      if (intervalMs === null) return null
      return new Date(Date.parse(job.lastRunAt) + intervalMs)
    }

    case "iso": {
      const target = Date.parse(job.schedule)
      if (Number.isNaN(target)) return null
      if (job.lastRunAt && Date.parse(job.lastRunAt) >= target) return null
      return new Date(target)
    }

    case "cron": {
      try {
        const interval = CronExpressionParser.parse(job.schedule, {
          currentDate: job.lastRunAt ? new Date(job.lastRunAt) : new Date(0),
        })
        const next = interval.next().toDate()
        return next
      } catch {
        return null
      }
    }

    case "phrase": {
      const cronExpr = phraseToCron(job.schedule)
      if (!cronExpr) return null
      try {
        const interval = CronExpressionParser.parse(cronExpr, {
          currentDate: job.lastRunAt ? new Date(job.lastRunAt) : new Date(0),
        })
        const next = interval.next().toDate()
        return next
      } catch {
        return null
      }
    }

    default:
      return null
  }
}

export function isJobDue(job: CronJob, now: Date = new Date()): boolean {
  const next = nextFireTime(job)
  if (!next) return false
  return next.getTime() <= now.getTime()
}

export function getDueJobs(jobs: Record<string, CronJob>, now: Date = new Date()): CronJob[] {
  return Object.values(jobs).filter((j) => isJobDue(j, now))
}
