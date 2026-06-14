import { eq, and, gte, sql } from "drizzle-orm"
import { db, usageEvents } from "@yomi/db"
import { ConnectorRegistry, runAgentLoop, type AgentMessage } from "@yomi/agent-core"
import {
  getAccessToken,
  listConnectedProviders,
} from "../services/integration-tokens.js"
import {
  hasBillablePlanAccess,
  requestLimitForUser,
  featureLimitForUser,
  isOwnerUser,
} from "../entitlements.js"
import * as authSchema from "../auth-schema.js"

export interface RunAgentOptions {
  userId: string
  text: string
  history?: AgentMessage[]
  signal?: AbortSignal
}

export interface RunAgentResult {
  text: string
  quotaError?: boolean
}

async function fetchUser(userId: string) {
  const [row] = await db
    .select({
      id: authSchema.user.id,
      email: authSchema.user.email,
      role: authSchema.user.role,
      plan: authSchema.user.plan,
      subscriptionStatus: authSchema.user.subscriptionStatus,
      currentPeriodEnd: authSchema.user.currentPeriodEnd,
    })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)
  return row ?? null
}

function currentMonthStart(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

// Run the lean agent loop server-side, with entitlement checks and usage logging.
// Called from the gateway when the desktop is offline. Returns the agent's final
// text reply, or a user-facing error message if quota or billing blocks it.
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const user = await fetchUser(opts.userId)
  if (!user) {
    return { text: "I couldn't find your account. Please re-link your account.", quotaError: false }
  }

  // Entitlement: billing plan access (7-day grace for past_due)
  if (!hasBillablePlanAccess(user)) {
    const status = user.subscriptionStatus ?? "inactive"
    const msg =
      status === "past_due"
        ? "Your payment is past due. Update your payment method to restore full access."
        : "Your subscription is inactive. Visit the dashboard to manage your plan."
    return { text: msg, quotaError: true }
  }

  // Entitlement: monthly chat request quota
  if (!isOwnerUser(user)) {
    const limit = requestLimitForUser(user)
    if (limit !== null) {
      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.userId, opts.userId),
            eq(usageEvents.kind, "gateway_message"),
            gte(usageEvents.createdAt, currentMonthStart()),
          ),
        )
      const used = Number(countRow?.count ?? 0)
      if (used >= limit) {
        return {
          text: `You've used ${used} of ${limit} messages this month. Upgrade your plan to continue.`,
          quotaError: true,
        }
      }
    }
  }

  // Log a gateway_message usage event before the LLM call.
  await db
    .insert(usageEvents)
    .values({
      userId: opts.userId,
      kind: "gateway_message",
      model: process.env["AI_CREDITS_AGENT_MODEL"] ?? "gpt-4.1",
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      status: "done",
    })
    .catch(() => { /* best-effort */ })

  // Connector limit: cap how many connected providers the agent may use this turn.
  const connectorLimit = isOwnerUser(user) ? Infinity : (featureLimitForUser(user, "connectors") ?? Infinity)

  const registry = new ConnectorRegistry({
    getAccessToken,
    listConnectedProviders: async (userId: string) => {
      const all = await listConnectedProviders(userId)
      return Number.isFinite(connectorLimit) ? all.slice(0, connectorLimit) : all
    },
  })
  await registry.init(opts.userId)

  const text = await runAgentLoop({
    registry,
    text: opts.text,
    history: opts.history,
    signal: opts.signal,
  })

  return { text }
}
