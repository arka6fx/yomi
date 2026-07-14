import { Hono } from "hono"
import { and, eq, gte, isNotNull, isNull, lt, ne } from "drizzle-orm"
import { db, usageEvents, creditAccounts, creditGrants } from "@yomi/db"
import { user } from "../auth-schema.js"
import { authenticate } from "../auth.js"
import { effectivePlanForUser, isOwnerUser } from "../entitlements.js"
import { grantCredits } from "../services/credit-ledger.js"
import { getPlan } from "@yomi/shared/plans"
import { costMicros } from "@yomi/shared/ai-pricing"

export const adminRouter = new Hono()

const TRIAL_DAYS = 30

type UsageMetadata = Record<string, unknown>

type CostBucket = {
  key: string
  requests: number
  inputTokens: number
  outputTokens: number
  latencyMs: number
  costMicros: number
}

function clampDays(raw: string | undefined): number {
  const days = Number.parseInt(raw ?? "30", 10)
  if (!Number.isFinite(days) || days <= 0) return 30
  return Math.min(days, 365)
}

function estimateCostMicros(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  costCents: number,
): number {
  if (costCents > 0) return costCents * 10_000
  return costMicros(model, { inputTokens, outputTokens })
}

function money(micros: number): number {
  return Math.round(micros) / 1_000_000
}

function metadataObject(value: unknown): UsageMetadata {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UsageMetadata)
    : {}
}

function metadataString(meta: UsageMetadata, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = meta[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return fallback
}

function metadataNumber(meta: UsageMetadata, keys: string[]): number {
  for (const key of keys) {
    const value = meta[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value)))
      return Number(value)
  }
  return 0
}

function connectorIds(meta: UsageMetadata): string[] {
  const raw = meta["connectorIds"] ?? meta["connectors"] ?? meta["connector"] ?? meta["provider"]
  if (Array.isArray(raw))
    return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  if (typeof raw === "string" && raw.trim()) return [raw.trim()]
  return []
}

function addBucket(
  map: Map<string, CostBucket>,
  key: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  costMicros: number,
): void {
  const bucket = map.get(key) ?? {
    key,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    costMicros: 0,
  }
  bucket.requests += 1
  bucket.inputTokens += inputTokens
  bucket.outputTokens += outputTokens
  bucket.latencyMs += latencyMs
  bucket.costMicros += costMicros
  map.set(key, bucket)
}

function serializeBucket(bucket: CostBucket) {
  return {
    key: bucket.key,
    requests: bucket.requests,
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    avgInputTokens: Math.round(bucket.inputTokens / Math.max(bucket.requests, 1)),
    avgOutputTokens: Math.round(bucket.outputTokens / Math.max(bucket.requests, 1)),
    avgLatencyMs: Math.round(bucket.latencyMs / Math.max(bucket.requests, 1)),
    estimatedCostUsd: money(bucket.costMicros),
  }
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7)
}

function currentMonthStart(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

// POST /api/admin/reset-all-usage
// Owner-only. Deletes all current-month usage events for every user and
// tops each user's credit balance back up to their plan's monthly allowance.
adminRouter.post("/reset-all-usage", authenticate, async (c) => {
  const caller = c.get("user")
  if (!isOwnerUser(caller)) {
    return c.json({ error: "Forbidden" }, 403)
  }

  const monthStart = currentMonthStart()
  const monthKey = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, "0")}`

  // 1. Wipe every usage event recorded this month for all users
  await db.delete(usageEvents).where(gte(usageEvents.createdAt, monthStart))

  // 2. Load all users + their current credit balances
  const allUsers = await db
    .select({ id: user.id, plan: user.plan, role: user.role, email: user.email })
    .from(user)
  const accounts = await db
    .select({ userId: creditAccounts.userId, balance: creditAccounts.availableCredits })
    .from(creditAccounts)
  const balanceByUser = new Map(accounts.map((a) => [a.userId, a.balance]))

  // 3. Top up each non-owner user's credits to their plan's monthly included amount
  let usersRestored = 0
  for (const u of allUsers) {
    if (isOwnerUser(u)) continue
    const plan = getPlan(u.plan ?? "explore")
    const balance = balanceByUser.get(u.id) ?? 0
    const deficit = plan.includedCredits - balance
    if (deficit <= 0) continue

    await grantCredits({
      userId: u.id,
      amount: deficit,
      source: "admin_adjustment",
      sourceId: `admin:reset:${monthKey}:${u.id}`,
      idempotencyKey: `admin:reset:${monthKey}:${u.id}`,
      reason: "Monthly usage reset by admin",
    })
    usersRestored++
  }

  return c.json({ ok: true, monthKey, usersTotal: allUsers.length, usersRestored })
})

// POST /api/admin/reset-explore-trials
// Owner-only. Restarts every explore trial from today and tops each balance up to the
// plan's included credits. Never lowers a balance, never touches the owner or purchased
// credit packs. Dry-run unless the body says { "dryRun": false }.
adminRouter.post("/reset-explore-trials", authenticate, async (c) => {
  const caller = c.get("user")
  if (!isOwnerUser(caller)) {
    return c.json({ error: "Forbidden" }, 403)
  }

  const body = (await c.req.json().catch(() => ({}))) as { dryRun?: boolean }
  const dryRun = body.dryRun !== false

  const now = new Date()
  const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000)
  const day = dayKey(now)
  const included = getPlan("explore").includedCredits

  const candidates = await db
    .select({
      id: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan,
      trialEndDate: user.trialEndDate,
    })
    .from(user)
    .where(isNull(user.deletedAt))

  const accounts = await db
    .select({ userId: creditAccounts.userId, balance: creditAccounts.availableCredits })
    .from(creditAccounts)
  const balanceByUser = new Map(accounts.map((a) => [a.userId, a.balance]))

  const users: Array<Record<string, unknown>> = []

  for (const u of candidates) {
    if (isOwnerUser(u)) continue
    if (effectivePlanForUser(u) !== "explore") continue

    const balance = balanceByUser.get(u.id) ?? 0
    const topUp = Math.max(0, included - balance)

    users.push({
      email: u.email,
      balanceBefore: balance,
      topUp,
      balanceAfter: balance + topUp,
      trialEndedAt: u.trialEndDate,
      trialEndsAt: trialEnd,
    })

    if (dryRun) continue

    await db
      .update(user)
      .set({ trialStartDate: now, trialEndDate: trialEnd })
      .where(eq(user.id, u.id))

    // Trial credits expire with the trial, so a restarted trial has to carry its live
    // grants forward or the balance would vanish mid-window. Only ever extends.
    await db
      .update(creditGrants)
      .set({ expiresAt: trialEnd })
      .where(
        and(
          eq(creditGrants.userId, u.id),
          eq(creditGrants.status, "active"),
          ne(creditGrants.source, "credit_pack"),
          isNotNull(creditGrants.expiresAt),
          lt(creditGrants.expiresAt, trialEnd),
        ),
      )

    if (topUp > 0) {
      await grantCredits({
        userId: u.id,
        amount: topUp,
        source: "admin_adjustment",
        sourceId: `admin:explore-reset:${day}:${u.id}`,
        idempotencyKey: `admin:explore-reset:${day}:${u.id}`,
        expiresAt: trialEnd,
        reason: "Explore trial restarted by admin",
        metadata: { plan: "explore", trialDays: TRIAL_DAYS },
      })
    }
  }

  return c.json({
    ok: true,
    dryRun,
    includedCredits: included,
    trialEndsAt: trialEnd,
    usersAffected: users.length,
    creditsGranted: users.reduce((sum, u) => sum + (u["topUp"] as number), 0),
    users,
  })
})

adminRouter.get("/cost-analytics", authenticate, async (c) => {
  const caller = c.get("user")
  if (!isOwnerUser(caller)) {
    return c.json({ error: "Forbidden" }, 403)
  }

  const days = clampDays(c.req.query("days"))
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const rows = await db
    .select({
      id: usageEvents.id,
      userId: usageEvents.userId,
      kind: usageEvents.kind,
      model: usageEvents.model,
      inputTokens: usageEvents.inputTokens,
      outputTokens: usageEvents.outputTokens,
      costCents: usageEvents.costCents,
      creditsCharged: usageEvents.creditsCharged,
      status: usageEvents.status,
      metadata: usageEvents.metadata,
      createdAt: usageEvents.createdAt,
    })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, since))

  const users = await db.select({ id: user.id, email: user.email, name: user.name }).from(user)
  const usersById = new Map(users.map((u) => [u.id, u]))

  const byEndpoint = new Map<string, CostBucket>()
  const byModel = new Map<string, CostBucket>()
  const byConnector = new Map<string, CostBucket>()
  const byTaskType = new Map<string, CostBucket>()
  const byUser = new Map<string, CostBucket>()
  const daily = new Map<string, CostBucket>()
  const monthly = new Map<string, CostBucket>()

  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalLatencyMs = 0
  let totalCostMicros = 0

  for (const row of rows) {
    const meta = metadataObject(row.metadata)
    const inputTokens = Number(row.inputTokens ?? 0)
    const outputTokens = Number(row.outputTokens ?? 0)
    const latencyMs = metadataNumber(meta, ["latencyMs", "latency_ms", "durationMs", "duration_ms"])
    const costMicros = estimateCostMicros(
      row.model,
      inputTokens,
      outputTokens,
      Number(row.costCents ?? 0),
    )
    const endpoint = metadataString(meta, ["endpoint", "route", "source"], row.kind)
    const taskType = metadataString(
      meta,
      ["taskType", "task_type", "intent", "reserveKind"],
      row.kind,
    )
    const model = row.model ?? "unknown"

    totalInputTokens += inputTokens
    totalOutputTokens += outputTokens
    totalLatencyMs += latencyMs
    totalCostMicros += costMicros

    addBucket(byEndpoint, endpoint, inputTokens, outputTokens, latencyMs, costMicros)
    addBucket(byModel, model, inputTokens, outputTokens, latencyMs, costMicros)
    addBucket(byTaskType, taskType, inputTokens, outputTokens, latencyMs, costMicros)
    addBucket(byUser, row.userId, inputTokens, outputTokens, latencyMs, costMicros)
    addBucket(daily, dayKey(row.createdAt), inputTokens, outputTokens, latencyMs, costMicros)
    addBucket(monthly, monthKey(row.createdAt), inputTokens, outputTokens, latencyMs, costMicros)

    const connectors = connectorIds(meta)
    if (connectors.length === 0) {
      addBucket(byConnector, "none", inputTokens, outputTokens, latencyMs, costMicros)
    } else {
      for (const connector of connectors)
        addBucket(byConnector, connector, inputTokens, outputTokens, latencyMs, costMicros)
    }
  }

  const serializeSorted = (map: Map<string, CostBucket>) =>
    Array.from(map.values())
      .sort((a, b) => b.costMicros - a.costMicros)
      .map(serializeBucket)

  const topUsers = Array.from(byUser.values())
    .sort((a, b) => b.costMicros - a.costMicros)
    .slice(0, 10)
    .map((bucket) => {
      const u = usersById.get(bucket.key)
      return {
        userId: bucket.key,
        email: u?.email ?? null,
        name: u?.name ?? null,
        ...serializeBucket(bucket),
      }
    })

  return c.json({
    generatedAt: new Date().toISOString(),
    period: { days, since: since.toISOString(), until: new Date().toISOString() },
    totals: {
      requests: rows.length,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      avgInputTokens: Math.round(totalInputTokens / Math.max(rows.length, 1)),
      avgOutputTokens: Math.round(totalOutputTokens / Math.max(rows.length, 1)),
      avgLatencyMs: Math.round(totalLatencyMs / Math.max(rows.length, 1)),
      estimatedCostUsd: money(totalCostMicros),
    },
    costPerEndpoint: serializeSorted(byEndpoint),
    costPerModel: serializeSorted(byModel),
    costPerConnector: serializeSorted(byConnector),
    tokenDistributionByTaskType: serializeSorted(byTaskType),
    dailySpend: Array.from(daily.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(serializeBucket),
    monthlySpend: Array.from(monthly.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(serializeBucket),
    topUsers,
  })
})
