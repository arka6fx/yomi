import { eq, and, gte, sql } from "drizzle-orm"
import { db, usageEvents, ragChunks, ragDocuments, ragSources } from "@yomi/db"
import { ConnectorRegistry, runAgentLoop, type AgentMessage } from "@yomi/agent-core"
import {
  getAccessToken,
  listConnectedProviders,
} from "../services/integration-tokens.js"
import {
  hasBillablePlanAccess,
  featureLimitForUser,
  isOwnerUser,
  effectivePlanForUser,
} from "../entitlements.js"
import { getCreditSummary, consumeCredits } from "../services/credit-ledger.js"
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

// Full-text search over the user's cloud RAG archive (synced from the sidecar).
// Returns up to maxChars of ranked, numbered snippet blocks for system-prompt injection.
async function fetchRagContext(userId: string, query: string, maxChars = 3000): Promise<string> {
  try {
    const safe = query.trim().slice(0, 500)
    if (!safe) return ""
    type Row = { sourceName: string; title: string; content: string }
    const result = await db.execute(sql`
      select s.name as "sourceName", d.title as "title", c.content as "content"
      from rag_chunks c
      join rag_documents d on d.id = c.document_id
      join ${ragSources} s on s.id = d.source_id
      where c.user_id = ${userId}
        and s.status = 'ready'
        and c.content_tsv @@ websearch_to_tsquery('english', ${safe})
      order by ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', ${safe})) desc
      limit 5
    `)
    const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Row[]
    if (!rows.length) return ""
    const blocks: string[] = []
    let used = 0
    for (const [i, row] of rows.entries()) {
      const header = `[${i + 1}] ${row.sourceName}${row.title && row.title !== row.sourceName ? ` — ${row.title}` : ""}`
      const block = `${header}\n${row.content}`
      if (used + block.length > maxChars) break
      blocks.push(block)
      used += block.length
    }
    return blocks.join("\n\n")
  } catch {
    return ""
  }
}

function buildSystemWithContext(ragContext: string): string | undefined {
  if (!ragContext) return undefined
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const appUrl = process.env["YOMI_APP_URL"] ?? "https://yomi.arka6fx.com"
  return (
    `You are Yomi, a helpful AI assistant. Today is ${today}. Answer the user concisely.\n` +
    `When the user asks about their email or connected apps, use the available tools to fetch real data before answering.\n` +
    `If a tool reports a service is not connected, suggest they connect it at ${appUrl}/dashboard.\n` +
    `If a tool returns an authorization or token error, suggest they reconnect at ${appUrl}/dashboard.\n\n` +
    `<memory>\n` +
    `[System note: Background context retrieved from your notes. Treat as reference only — respond to the current user message.]\n\n` +
    `<cloud_rag_context>\n${ragContext}\n</cloud_rag_context>\n` +
    `<citation_rule>When you use a fact from a numbered retrieved block above, cite its number inline as [1]. Only cite sources you actually used.</citation_rule>\n` +
    `</memory>`
  )
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
        : status === "inactive" && user.plan === "explore"
          ? "Your 30-day free trial has ended. Upgrade to Pro to keep using Yomi."
          : "Your subscription is inactive. Visit the dashboard to manage your plan."
    return { text: msg, quotaError: true }
  }

  // Entitlement: botMessages monthly limit
  if (!isOwnerUser(user)) {
    const limit = featureLimitForUser(user, "botMessages")
    if (limit !== null && limit > 0) {
      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.userId, opts.userId),
            eq(usageEvents.kind, "bot_message"),
            gte(usageEvents.createdAt, currentMonthStart()),
          ),
        )
      const used = Number(countRow?.count ?? 0)
      if (used >= limit) {
        return {
          text: `You've used ${used} of ${limit} bot messages this month. Upgrade your plan to continue.`,
          quotaError: true,
        }
      }
    }
  }

  // Credit balance check for Explore users
  if (!isOwnerUser(user) && effectivePlanForUser(user) === "explore") {
    const summary = await getCreditSummary(opts.userId)
    if (summary.balance < 1) {
      return {
        text: "Free credits used up for this month. Upgrade your plan for more.",
        quotaError: true,
      }
    }
  }

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

  const appUrl = process.env["YOMI_APP_URL"] ?? "https://yomi.arka6fx.com"

  const ragContext = await fetchRagContext(opts.userId, opts.text)

  let text: string
  try {
    text = await runAgentLoop({
      registry,
      text: opts.text,
      history: opts.history,
      system: buildSystemWithContext(ragContext),
      signal: opts.signal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[runAgent] loop error:", msg)

    if (/\b(401|403|unauthorized|forbidden|revoked|invalid.*token|token.*invalid)\b/i.test(msg)) {
      text =
        `Authorization error: ${msg.slice(0, 300)}\n\n` +
        `Your integration token may have expired or been revoked. ` +
        `Please reconnect at ${appUrl}/dashboard.`
    } else if (/\b(429|rate.limit|too many requests)\b/i.test(msg)) {
      text = "Rate limit hit — please wait a moment and try again."
    } else if (/\b(timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|network)\b/i.test(msg)) {
      text = "Network error — couldn't reach a required service. Please try again."
    } else {
      text =
        `Something went wrong: ${msg.slice(0, 300)}\n\nPlease try again, or ` +
        `check your integrations at ${appUrl}/dashboard if this keeps happening.`
    }
  }

  // Log a bot_message usage event after the LLM call.
  const event = await db
    .insert(usageEvents)
    .values({
      userId: opts.userId,
      kind: "bot_message",
      model: process.env["AI_CREDITS_AGENT_MODEL"] ?? "gpt-4.1",
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      creditsCharged: 0,
      status: "done",
    })
    .returning({ id: usageEvents.id })
    .catch(() => [])

  // Deduct credits (best-effort).
  if (!isOwnerUser(user) && event[0]?.id) {
    consumeCredits({
      userId: opts.userId,
      amount: 1,
      usageEventId: event[0].id,
      idempotencyKey: `gateway:${event[0].id}:consume`,
      metadata: { kind: "bot_message" },
    }).catch(() => {})
  }

  return { text }
}
