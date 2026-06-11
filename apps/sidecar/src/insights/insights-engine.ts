import type { Plan } from "@yomi/shared"
import {
  queryUsageEvents,
  querySessions,
  queryDailyUsage,
  queryDailySessions,
  queryHourlyActivity,
  queryModelDistribution,
  querySessionLengths,
  type SessionRow,
  type UsageEventRow,
} from "./usage-store.js"

export type InsightsReport = {
  generatedAt: string
  periodDays: number
  plan: Plan
  overview: OverviewSection
  tokenConsumption: TokenConsumptionSection
  costBreakdown: CostBreakdownSection
  modelDistribution: ModelDistributionSection
  activity: ActivitySection
}

export type OverviewSection = {
  totalSessions: number
  totalQueries: number
  totalTokens: number
  estimatedCostCents: number
  fastSessions: number
  agentSessions: number
  periodStart: string
  periodEnd: string
}

export type TokenConsumptionSection = {
  dailyTrend: { date: string; input: number; output: number }[]
  weeklyTrend: { week: string; input: number; output: number }[]
}

export type CostBreakdownSection = {
  byKind: { kind: string; sessions: number; costCents: number; tokens: number }[]
  totalCostCents: number
}

export type ModelDistributionSection = {
  models: { model: string; count: number; avgTokens: number; pct: number }[]
}

export type ActivitySection = {
  peakHour: number
  mostActiveDay: string
  sessionLengths: { avgSeconds: number; medianSeconds: number; count: number }
  hourlyBreakdown: { hour: number; count: number }[]
}

// Model pricing in cents per 1K tokens (approximate)
const MODEL_PRICING: Record<string, { inputCentsPer1K: number; outputCentsPer1K: number }> = {
  "minimax.minimax-m2.5": { inputCentsPer1K: 0.2, outputCentsPer1K: 0.6 },
}

const DEFAULT_PRICING = { inputCentsPer1K: 1.0, outputCentsPer1K: 4.0 }

// Plan lookback limits in days
export const INSIGHT_LOOKBACK: Record<Plan, number> = {
  explore: 7,
  pro: 90,
  max: 365,
}

const KINDS: Record<string, string> = {
  fast_query: "Fast query",
  agent_run: "Agent run",
  stt: "Speech-to-text",
  tts: "Text-to-speech",
  compression: "Context compression",
}

function estimateCost(model: string | null, inputTokens: number, outputTokens: number): number {
  if (inputTokens === 0 && outputTokens === 0) return 0
  const pricing = MODEL_PRICING[model ?? ""] ?? DEFAULT_PRICING
  const inputCost = (inputTokens / 1000) * pricing.inputCentsPer1K
  const outputCost = (outputTokens / 1000) * pricing.outputCentsPer1K
  return Math.round(inputCost + outputCost)
}

export function getMaxLookback(plan: Plan): number {
  return INSIGHT_LOOKBACK[plan] ?? 7
}

/** Generate a full insights report for the given lookback period. */
export function generateReport(days: number, plan: Plan): InsightsReport {
  const maxDays = getMaxLookback(plan)
  const actualDays = Math.min(days, maxDays)

  const sessions = querySessions(actualDays)
  const events = queryUsageEvents(actualDays)

  const now = new Date()
  const periodStart = new Date(now.getTime() - actualDays * 86_400_000)

  const totalTokens = sessions.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0)
  const estimatedCost = sessions.reduce(
    (s, r) => s + estimateCost(r.model, r.inputTokens, r.outputTokens),
    0,
  )

  const fastSessions = sessions.filter((s) => s.kind === "fast").length
  const agentSessions = sessions.filter((s) => s.kind === "agent").length

  // Daily token trends
  const dailySessions = queryDailySessions(actualDays)
  const dailyTrend = dailySessions.map((d) => ({
    date: d.date,
    input: 0, // per-kind aggregation loses input vs output; refetch raw
    output: 0,
  }))

  // Rebuild daily trend from raw sessions for input/output split
  const dayBuckets = groupBy(sessions, (r) => r.startedAt.slice(0, 10))
  const rebuiltTrend: { date: string; input: number; output: number }[] = []
  for (const [date, rows] of Object.entries(dayBuckets)) {
    rebuiltTrend.push({
      date,
      input: rows.reduce((s, r) => s + r.inputTokens, 0),
      output: rows.reduce((s, r) => s + r.outputTokens, 0),
    })
  }
  rebuiltTrend.sort((a, b) => a.date.localeCompare(b.date))

  // Weekly trends
  const weeklyBuckets = groupBy(sessions, (r) => {
    const d = new Date(r.startedAt)
    const weekStart = new Date(d)
    weekStart.setDate(d.getDate() - d.getDay())
    return weekStart.toISOString().slice(0, 10)
  })
  const weeklyTrend: { week: string; input: number; output: number }[] = []
  for (const [week, rows] of Object.entries(weeklyBuckets)) {
    weeklyTrend.push({
      week,
      input: rows.reduce((s, r) => s + r.inputTokens, 0),
      output: rows.reduce((s, r) => s + r.outputTokens, 0),
    })
  }
  weeklyTrend.sort((a, b) => a.week.localeCompare(b.week))

  // Cost by kind
  const kindBuckets = groupBy(sessions, (r) => r.kind)
  const byKind: CostBreakdownSection["byKind"] = []
  for (const [kind, rows] of Object.entries(kindBuckets)) {
    const tokens = rows.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0)
    const cost = rows.reduce((s, r) => s + estimateCost(r.model, r.inputTokens, r.outputTokens), 0)
    byKind.push({
      kind: kind === "fast" ? "Fast query" : "Agent run",
      sessions: rows.length,
      costCents: cost,
      tokens,
    })
  }

  // Model distribution
  const modelRows = queryModelDistribution(actualDays)
  const totalModelSessions = modelRows.reduce((s, r) => s + r.count, 0)
  const models = modelRows.map((r) => ({
    model: r.model ?? "unknown",
    count: r.count,
    avgTokens: r.avgTokens,
    pct: totalModelSessions > 0 ? Math.round((r.count / totalModelSessions) * 100) : 0,
  }))

  // Hourly activity
  const hourlyData = queryHourlyActivity(actualDays)
  const peakHour = hourlyData.length > 0
    ? hourlyData.sort((a, b) => b.count - a.count)[0]!.hour
    : 0

  // Most active day
  const dayCounts = groupBy(sessions, (r) => r.startedAt.slice(0, 10))
  const mostActiveDay =
    Object.entries(dayCounts).sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? "N/A"

  // Session lengths
  const lengthRows = querySessionLengths(actualDays)
  const lengths = lengthRows.map((r) => r.seconds)
  const avgSeconds = lengths.length > 0 ? Math.round(lengths.reduce((s, v) => s + v, 0) / lengths.length) : 0
  const sorted = [...lengths].sort((a, b) => a - b)
  const medianSeconds: number =
    sorted.length > 0
      ? sorted.length % 2 === 0
        ? Math.round(((sorted[sorted.length / 2 - 1] ?? 0) + (sorted[sorted.length / 2] ?? 0)) / 2)
        : (sorted[Math.floor(sorted.length / 2)] ?? 0)
      : 0

  return {
    generatedAt: now.toISOString(),
    periodDays: actualDays,
    plan,
    overview: {
      totalSessions: sessions.length,
      totalQueries: events.length,
      totalTokens,
      estimatedCostCents: estimatedCost,
      fastSessions,
      agentSessions,
      periodStart: periodStart.toISOString(),
      periodEnd: now.toISOString(),
    },
    tokenConsumption: {
      dailyTrend: rebuiltTrend,
      weeklyTrend,
    },
    costBreakdown: {
      byKind,
      totalCostCents: estimatedCost,
    },
    modelDistribution: {
      models,
    },
    activity: {
      peakHour,
      mostActiveDay,
      sessionLengths: {
        avgSeconds,
        medianSeconds,
        count: lengths.length,
      },
      hourlyBreakdown: hourlyData,
    },
  }
}

/** Format a report as a terminal-friendly string. */
export function formatTerminal(report: InsightsReport): string {
  const lines: string[] = []
  const { overview, tokenConsumption, costBreakdown, modelDistribution, activity } = report

  lines.push("=".repeat(60))
  lines.push(`  Yomi Insights — Last ${report.periodDays} days (${report.plan})`)
  lines.push("=".repeat(60))
  lines.push("")

  // Overview
  lines.push("── Overview ".padEnd(60, "─"))
  lines.push(`  Total sessions:      ${overview.totalSessions}`)
  lines.push(`  Total queries:       ${overview.totalQueries}`)
  lines.push(`  Fast / Agent:        ${overview.fastSessions} / ${overview.agentSessions}`)
  lines.push(`  Total tokens:        ${overview.totalTokens.toLocaleString()}`)
  lines.push(`  Estimated cost:      $${(overview.estimatedCostCents / 100).toFixed(2)}`)
  lines.push(`  Period:              ${overview.periodStart.slice(0, 10)} – ${overview.periodEnd.slice(0, 10)}`)
  lines.push("")

  // Token consumption
  if (tokenConsumption.dailyTrend.length > 0) {
    lines.push("── Token Consumption ".padEnd(60, "─"))
    for (const day of tokenConsumption.dailyTrend.slice(-7)) {
      const total = day.input + day.output
      lines.push(`  ${day.date}:  ${total.toLocaleString().padStart(8)} tokens  (${day.input.toLocaleString()} in / ${day.output.toLocaleString()} out)`)
    }
    lines.push("")
  }

  // Cost breakdown
  if (costBreakdown.byKind.length > 0) {
    lines.push("── Cost Breakdown ".padEnd(60, "─"))
    for (const entry of costBreakdown.byKind) {
      lines.push(`  ${entry.kind.padEnd(15)} ${entry.sessions.toString().padStart(4)} sessions  $${(entry.costCents / 100).toFixed(2).padStart(7)}  ${entry.tokens.toLocaleString().padStart(10)} tokens`)
    }
    lines.push(`  ${"Total".padEnd(15)} ${"".padStart(4)} $${(costBreakdown.totalCostCents / 100).toFixed(2).padStart(7)}`)
    lines.push("")
  }

  // Model distribution
  if (modelDistribution.models.length > 0) {
    lines.push("── Model Distribution ".padEnd(60, "─"))
    for (const m of modelDistribution.models) {
      lines.push(`  ${m.model.padEnd(20)} ${m.count.toString().padStart(4)} calls  ${m.pct.toString().padStart(3)}%  avg ${m.avgTokens.toLocaleString().padStart(7)} tokens`)
    }
    lines.push("")
  }

  // Activity
  lines.push("── Activity ".padEnd(60, "─"))
  lines.push(`  Peak hour:           ${activity.peakHour}:00 (${activity.hourlyBreakdown.find((h) => h.hour === activity.peakHour)?.count ?? 0} sessions)`)
  lines.push(`  Most active day:     ${activity.mostActiveDay}`)
  lines.push(`  Avg session length:  ${formatDuration(activity.sessionLengths.avgSeconds)}`)
  lines.push(`  Median session:      ${formatDuration(activity.sessionLengths.medianSeconds)}`)

  return lines.join("\n")
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const map: Record<string, T[]> = {}
  for (const item of items) {
    const key = keyFn(item)
    if (!map[key]) map[key] = []
    map[key].push(item)
  }
  return map
}
