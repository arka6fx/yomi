// Cron scheduler types — job definitions, schedule formats, plan limits.

export type ScheduleType = "duration" | "phrase" | "cron" | "iso"

export type CronJobStatus = "success" | "error" | null

export interface CronJob {
  id: string
  schedule: string
  scheduleType: ScheduleType
  prompt: string
  skills?: string[]
  model?: string
  provider?: string
  script?: string
  noAgent?: boolean
  contextFrom?: string
  workdir?: string
  deliverTo?: string[]
  enabled: boolean
  oneShot: boolean
  createdAt: string
  updatedAt: string
  lastRunAt: string | null
  lastRunStatus: CronJobStatus
  runCount: number
}

export interface CronJobStore {
  version: 1
  jobs: Record<string, CronJob>
}

export interface CronJobResult {
  ok: boolean
  jobId: string
  outputPath?: string
  outputPreview?: string
  error?: string
  durationMs: number
}

export const CRON_LIMITS: Record<string, number> = {
  explore: 0,
  pro: 5,
  max: 20,
} as const

export const MIN_INTERVAL_SECONDS: Record<string, number> = {
  explore: Infinity,
  pro: 60,
  max: 30,
} as const

export function cronLimitForPlan(plan: string | undefined): number {
  if (!plan) return 0
  return CRON_LIMITS[plan.toLowerCase()] ?? 0
}

export function isCronAllowed(plan: string | undefined): boolean {
  return cronLimitForPlan(plan) > 0
}

export interface CronAccessDecision {
  ok: boolean
  reason?: string
  upgradeUrl?: string
}

export function planLimitsHelpUrl(): string {
  return "https://yomi.example.com/upgrade"
}

export function checkCronAccess(
  plan: string | undefined,
  action: string,
  currentCount: number,
): CronAccessDecision {
  if (!isCronAllowed(plan)) {
    return {
      ok: false,
      reason: `cron is a Pro feature. Upgrade at ${planLimitsHelpUrl()}.`,
    }
  }
  if (action === "create" && currentCount >= cronLimitForPlan(plan)) {
    const limit = cronLimitForPlan(plan)
    return {
      ok: false,
      reason: `cron job limit reached (${currentCount}/${limit}). Upgrade at ${planLimitsHelpUrl()}.`,
    }
  }
  return { ok: true }
}

export function validateScheduleInput(schedule: string): {
  ok: boolean
  scheduleType?: ScheduleType
  error?: string
} {
  if (!schedule || typeof schedule !== "string") {
    return { ok: false, error: "schedule is required" }
  }
  const trimmed = schedule.trim().toLowerCase()

  // Duration: /^\d+[mhd]$/
  if (/^\d+[mhd]$/.test(trimmed)) {
    const num = parseInt(trimmed, 10)
    if (trimmed.endsWith("m") && num < 1) {
      return { ok: false, error: "minimum duration is 1m" }
    }
    return { ok: true, scheduleType: "duration" }
  }

  // ISO timestamp: must include T and Z or offset
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(schedule)) {
    const d = Date.parse(schedule)
    if (Number.isNaN(d)) {
      return { ok: false, error: "invalid ISO timestamp" }
    }
    return { ok: true, scheduleType: "iso" }
  }

  // Cron expression: 5 fields separated by spaces
  if (/^(\S+\s+){4}\S+$/.test(trimmed)) {
    return { ok: true, scheduleType: "cron" }
  }

  // Phrase: starts with "every"
  if (trimmed.startsWith("every")) {
    return { ok: true, scheduleType: "phrase" }
  }

  return { ok: false, error: `unrecognised schedule format: "${schedule}"` }
}
