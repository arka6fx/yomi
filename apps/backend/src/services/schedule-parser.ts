// Schedule parsing for cloud-managed schedules. Self-contained (no cron lib) since
// the accepted formats are a known, limited set. All evaluation is in UTC.
//
// Supported: duration ("30m", "2h", "1d"), phrase ("every day 9am"), 5-field cron
// ("0 9 * * 1-5"), and ISO timestamp.

export type ScheduleType = "duration" | "phrase" | "cron" | "iso"

export function validateScheduleInput(schedule: string): {
  ok: boolean
  scheduleType?: ScheduleType
  error?: string
} {
  if (!schedule || typeof schedule !== "string") return { ok: false, error: "schedule is required" }
  const trimmed = schedule.trim().toLowerCase()

  if (/^\d+[mhd]$/.test(trimmed)) {
    if (trimmed.endsWith("m") && parseInt(trimmed, 10) < 1)
      return { ok: false, error: "minimum duration is 1m" }
    return { ok: true, scheduleType: "duration" }
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(schedule)) {
    if (Number.isNaN(Date.parse(schedule))) return { ok: false, error: "invalid ISO timestamp" }
    return { ok: true, scheduleType: "iso" }
  }
  if (/^(\S+\s+){4}\S+$/.test(trimmed)) return { ok: true, scheduleType: "cron" }
  if (trimmed.startsWith("every")) {
    if (!phraseToCron(trimmed)) return { ok: false, error: `unrecognised phrase: "${schedule}"` }
    return { ok: true, scheduleType: "phrase" }
  }
  return { ok: false, error: `unrecognised schedule format: "${schedule}"` }
}

export function parseDurationMs(schedule: string): number | null {
  const m = schedule
    .trim()
    .toLowerCase()
    .match(/^(\d+)([mhd])$/)
  if (!m) return null
  const n = parseInt(m[1]!, 10)
  return m[2] === "m" ? n * 60_000 : m[2] === "h" ? n * 3_600_000 : n * 86_400_000
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

  const dayMatch = p.match(
    /^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i,
  )
  if (dayMatch) {
    const day = dayMap[dayMatch[1]!]
    const { hour, minute } = to24h(dayMatch[2]!, dayMatch[3], dayMatch[4])
    if (day !== undefined && hour !== null) return `${minute} ${hour} * * ${day}`
  }
  const everyN = p.match(/^every\s+(\d+)\s*(h|hour|hours)$/i)
  if (everyN) {
    const n = parseInt(everyN[1]!, 10)
    if (n >= 1) return `0 */${n} * * *`
  }
  const dayAt = p.match(/^every\s+day\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (dayAt) {
    const { hour, minute } = to24h(dayAt[1]!, dayAt[2], dayAt[3])
    if (hour !== null) return `${minute} ${hour} * * *`
  }
  if (/^every\s*(hour|1h|1\s*hour)$/i.test(p)) return "0 * * * *"
  const weekday = p.match(/^every\s+weekday\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (weekday) {
    const { hour, minute } = to24h(weekday[1]!, weekday[2], weekday[3])
    if (hour !== null) return `${minute} ${hour} * * 1-5`
  }
  return null
}

function to24h(
  hourStr: string,
  minStr: string | undefined,
  ampm: string | undefined,
): { hour: number | null; minute: number } {
  let hour = parseInt(hourStr, 10)
  const minute = minStr ? parseInt(minStr, 10) : 0
  if (ampm) {
    const lower = ampm.toLowerCase()
    if (lower === "pm" && hour < 12) hour += 12
    if (lower === "am" && hour === 12) hour = 0
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return { hour: null, minute: 0 }
  return { hour, minute }
}

// Match a single cron field (supports *, */n, a-b, a-b/n, a,b, single int).
function matchField(value: number, expr: string, min: number, max: number): boolean {
  for (const part of expr.split(",")) {
    const [rangePart, stepPart] = part.split("/")
    const step = stepPart ? parseInt(stepPart, 10) : 1
    if (!Number.isFinite(step) || step < 1) continue
    let lo = min
    let hi = max
    if (rangePart && rangePart !== "*") {
      if (rangePart.includes("-")) {
        const [a, b] = rangePart.split("-").map((x) => parseInt(x, 10))
        if (!Number.isFinite(a!) || !Number.isFinite(b!)) continue
        lo = a!
        hi = b!
      } else {
        const n = parseInt(rangePart, 10)
        if (!Number.isFinite(n)) continue
        lo = n
        hi = stepPart ? max : n
      }
    }
    if (value < lo || value > hi) continue
    if ((value - lo) % step === 0) return true
  }
  return false
}

function matchesCron(date: Date, cronExpr: string): boolean {
  const fields = cronExpr.trim().split(/\s+/)
  if (fields.length !== 5) return false
  const [min, hr, dom, mon, dowRaw] = fields
  const dow = date.getUTCDay() // 0=Sun..6=Sat
  return (
    matchField(date.getUTCMinutes(), min!, 0, 59) &&
    matchField(date.getUTCHours(), hr!, 0, 23) &&
    matchField(date.getUTCDate(), dom!, 1, 31) &&
    matchField(date.getUTCMonth() + 1, mon!, 1, 12) &&
    // cron allows 7 for Sunday; normalise the field's 7 to 0 by also testing dow+7
    (matchField(dow, dowRaw!, 0, 6) || matchField(dow === 0 ? 7 : dow, dowRaw!, 0, 7))
  )
}

const MAX_SCAN_MINUTES = 366 * 24 * 60

function nextCronRun(cronExpr: string, after: Date): Date | null {
  const start = new Date(after.getTime())
  start.setUTCSeconds(0, 0)
  start.setUTCMinutes(start.getUTCMinutes() + 1) // strictly after
  for (let i = 0; i < MAX_SCAN_MINUTES; i++) {
    const candidate = new Date(start.getTime() + i * 60_000)
    if (matchesCron(candidate, cronExpr)) return candidate
  }
  return null
}

// Compute the next fire time (UTC) for a schedule, or null if it should not run again.
export function computeNextRun(input: {
  scheduleType: ScheduleType
  schedule: string
  lastRunAt?: Date | null
  now?: Date
}): Date | null {
  const now = input.now ?? new Date()
  switch (input.scheduleType) {
    case "duration": {
      const interval = parseDurationMs(input.schedule)
      if (interval === null) return null
      if (!input.lastRunAt) return now
      return new Date(input.lastRunAt.getTime() + interval)
    }
    case "iso": {
      const target = Date.parse(input.schedule)
      if (Number.isNaN(target)) return null
      if (input.lastRunAt && input.lastRunAt.getTime() >= target) return null
      return new Date(target)
    }
    case "cron":
      return nextCronRun(
        input.schedule,
        input.lastRunAt && input.lastRunAt > now ? input.lastRunAt : now,
      )
    case "phrase": {
      const expr = phraseToCron(input.schedule)
      if (!expr) return null
      return nextCronRun(expr, input.lastRunAt && input.lastRunAt > now ? input.lastRunAt : now)
    }
    default:
      return null
  }
}

// Plan limits (mirrors sidecar CRON_LIMITS). Explore has no scheduling.
export const SCHEDULE_LIMITS: Record<string, number> = { explore: 0, pro: 5, max: 20 }

export function scheduleLimitForPlan(plan: string | undefined): number {
  return plan ? (SCHEDULE_LIMITS[plan.toLowerCase()] ?? 0) : 0
}
