import { Hono } from "hono"
import { and, desc, eq, sql } from "drizzle-orm"
import { db, mcpConnections, platformConnections, schedules } from "@yomi/db"
import { authenticate } from "../auth.js"
import {
  effectivePlanForUser,
  getPlanConfig,
  hasBillablePlanAccess,
  isOwnerUser,
} from "../entitlements.js"
import { getCreditSummary } from "../services/credit-ledger.js"
import { getDefaultGateway } from "../gateway/gateway-runner.js"
import { getConnectorDef } from "../connectors/registry.js"

export const statusRouter = new Hono()

statusRouter.use("*", authenticate)

type CheckLevel = "ok" | "warn" | "down"
type Check = { id: string; label: string; level: CheckLevel; detail: string }

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value === "string" && value) {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function displayName(provider: string): string {
  return getConnectorDef(provider)?.name ?? provider
}

// Cloud "Status" panel data — replaces the old local desktop diagnostics. Aggregates
// everything a user needs to confirm Yomi is healthy: gateway, plan/billing, credits,
// Telegram link, connectors, and scheduled tasks. Best-effort: a failure in any one
// section degrades to a warning rather than failing the whole response.
statusRouter.get("/", async (c) => {
  const user = c.get("user")
  const owner = isOwnerUser(user)
  const plan = effectivePlanForUser(user)
  const planName = getPlanConfig(user).name
  const checks: Check[] = []

  // Gateway
  let gateway: { running: boolean; activeSessions: number; adapters: { platform: string; connected: boolean }[] }
  try {
    gateway = getDefaultGateway().getStatus()
  } catch {
    gateway = { running: false, activeSessions: 0, adapters: [] }
  }
  checks.push({
    id: "gateway",
    label: "Messaging gateway",
    level: gateway.running ? "ok" : "warn",
    detail: gateway.running
      ? `Online · ${gateway.adapters.length} adapter${gateway.adapters.length === 1 ? "" : "s"}`
      : "Starts on first request",
  })

  // Plan / billing access
  const billingAccess = hasBillablePlanAccess({
    ...user,
    subscriptionStatus: user.subscriptionStatus ?? null,
    currentPeriodEnd: toDate(user.currentPeriodEnd),
    trialEndDate: toDate(user.trialEndDate),
  })
  checks.push({
    id: "plan",
    label: "Plan access",
    level: owner ? "ok" : billingAccess ? "ok" : "down",
    detail: owner
      ? "Owner · unlimited"
      : billingAccess
        ? `${planName} · active`
        : plan === "explore"
          ? "Trial ended — subscribe to continue"
          : "Billing inactive — payment needed",
  })

  // Credits
  let balance = 0
  try {
    const summary = await getCreditSummary(user.id)
    balance = summary.balance
  } catch {
    // ignore — leave balance at 0
  }
  checks.push({
    id: "credits",
    label: "Credits",
    level: owner ? "ok" : balance > 0 ? "ok" : "warn",
    detail: owner ? "Unlimited" : `${balance} available`,
  })

  // Telegram link
  let telegram: { connected: boolean; linkedAt: string | null } = { connected: false, linkedAt: null }
  try {
    const [link] = await db
      .select({ connectedAt: platformConnections.connectedAt })
      .from(platformConnections)
      .where(and(eq(platformConnections.userId, user.id), eq(platformConnections.platform, "telegram")))
      .orderBy(desc(platformConnections.connectedAt))
      .limit(1)
    telegram = { connected: !!link, linkedAt: link?.connectedAt ? new Date(link.connectedAt).toISOString() : null }
  } catch {
    // ignore
  }
  checks.push({
    id: "telegram",
    label: "Telegram",
    level: telegram.connected ? "ok" : "warn",
    detail: telegram.connected ? "Linked" : "Not connected",
  })

  // Connectors
  let connectors: { total: number; needsReconnect: { provider: string; displayName: string }[] } = {
    total: 0,
    needsReconnect: [],
  }
  try {
    const rows = await db
      .select({ provider: mcpConnections.provider, expiresAt: mcpConnections.expiresAt })
      .from(mcpConnections)
      .where(eq(mcpConnections.userId, user.id))
    const now = Date.now()
    const needsReconnect = rows
      .filter((r) => r.expiresAt instanceof Date && r.expiresAt.getTime() < now)
      .map((r) => ({ provider: r.provider, displayName: displayName(r.provider) }))
    connectors = { total: rows.length, needsReconnect }
  } catch {
    // ignore
  }
  checks.push({
    id: "connectors",
    label: "App connectors",
    level: connectors.needsReconnect.length > 0 ? "warn" : "ok",
    detail:
      connectors.total === 0
        ? "None connected"
        : connectors.needsReconnect.length > 0
          ? `${connectors.needsReconnect.length} need reconnecting`
          : `${connectors.total} healthy`,
  })

  // Schedules
  let scheduleInfo: { total: number; enabled: number; nextRunAt: string | null } = {
    total: 0,
    enabled: 0,
    nextRunAt: null,
  }
  try {
    const [counts] = await db
      .select({
        total: sql<number>`count(*)`,
        enabled: sql<number>`count(*) filter (where ${schedules.enabled})`,
        nextRunAt: sql<Date | null>`min(${schedules.nextRunAt}) filter (where ${schedules.enabled})`,
      })
      .from(schedules)
      .where(eq(schedules.userId, user.id))
    scheduleInfo = {
      total: Number(counts?.total ?? 0),
      enabled: Number(counts?.enabled ?? 0),
      nextRunAt: counts?.nextRunAt ? new Date(counts.nextRunAt).toISOString() : null,
    }
  } catch {
    // ignore — table may be empty
  }
  checks.push({
    id: "schedules",
    label: "Scheduled tasks",
    level: "ok",
    detail:
      scheduleInfo.enabled > 0
        ? `${scheduleInfo.enabled} active`
        : scheduleInfo.total > 0
          ? "All paused"
          : "None scheduled",
  })

  const worstLevel: CheckLevel = checks.some((ch) => ch.level === "down")
    ? "down"
    : checks.some((ch) => ch.level === "warn")
      ? "warn"
      : "ok"

  return c.json({
    overall: worstLevel,
    generatedAt: new Date().toISOString(),
    plan: { plan, name: planName, status: user.subscriptionStatus ?? "inactive", isOwner: owner, billingAccess },
    credits: { balance },
    gateway,
    telegram,
    connectors,
    schedules: scheduleInfo,
    checks,
  })
})
