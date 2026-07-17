import { and, eq, gte } from "drizzle-orm"
import { db, aiUsageEvents } from "@yomi/db"

// Coarse day-part clustering. Tunable per ADR-0001; the exact boundaries are an
// internal detail behind this function and its dedupKey computation downstream.
export type TimeBucket = "morning" | "afternoon" | "evening"

// A behavioral pattern the user genuinely earned: a connector used on
// >=MIN_DISTINCT_DAYS distinct days within LOOKBACK_DAYS, clustered in one bucket.
export interface EarnedPattern {
  connector: string
  timeBucket: TimeBucket
  distinctDays: number
}

const LOOKBACK_DAYS = 30
const MIN_DISTINCT_DAYS = 3

// Buckets are computed on the UTC hour — there is no per-user timezone yet, so
// this is deliberately coarse; tighten to user-local when timezone exists.
function bucketOf(createdAt: Date): TimeBucket {
  const hour = createdAt.getUTCHours()
  if (hour >= 5 && hour < 12) return "morning"
  if (hour >= 12 && hour < 17) return "afternoon"
  return "evening"
}

function dayKey(createdAt: Date): string {
  return `${createdAt.getUTCFullYear()}-${createdAt.getUTCMonth()}-${createdAt.getUTCDate()}`
}

// Deterministic evidence gate: SQL over content-free telemetry, then code-side
// distinct-day counting. No model is involved (ADR-0001).
export async function earnedPatterns(userId: string, now: Date): Promise<EarnedPattern[]> {
  const cutoff = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const rows = await db
    .select({ connectorIds: aiUsageEvents.connectorIds, createdAt: aiUsageEvents.createdAt })
    .from(aiUsageEvents)
    .where(and(eq(aiUsageEvents.userId, userId), gte(aiUsageEvents.createdAt, cutoff)))

  // connector -> bucket -> set of distinct day keys. The metric is distinct-day
  // count per (connector, bucket), so a busy single day only ever counts once.
  const daysByPattern = new Map<string, Map<TimeBucket, Set<string>>>()
  for (const row of rows) {
    const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)
    if (createdAt < cutoff) continue // defensive: re-apply window in code
    const bucket = bucketOf(createdAt)
    const day = dayKey(createdAt)
    for (const connector of row.connectorIds ?? []) {
      let buckets = daysByPattern.get(connector)
      if (!buckets) daysByPattern.set(connector, (buckets = new Map()))
      let set = buckets.get(bucket)
      if (!set) buckets.set(bucket, (set = new Set()))
      set.add(day)
    }
  }

  const patterns: EarnedPattern[] = []
  for (const [connector, buckets] of daysByPattern) {
    for (const [timeBucket, set] of buckets) {
      if (set.size < MIN_DISTINCT_DAYS) continue
      patterns.push({ connector, timeBucket, distinctDays: set.size })
    }
  }

  // deterministic order: strongest evidence first, then stable by identity
  patterns.sort(
    (a, b) =>
      b.distinctDays - a.distinctDays ||
      a.connector.localeCompare(b.connector) ||
      a.timeBucket.localeCompare(b.timeBucket),
  )
  return patterns
}
