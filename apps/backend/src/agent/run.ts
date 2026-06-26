import { eq, and, sql, desc, ilike, or } from "drizzle-orm"
import { generateText } from "ai"
import { db, ragChunks, ragDocuments, ragSources, memoryEntries } from "@yomi/db"
import { ConnectorRegistry, createModel, runAgentLoop, type AgentMessage } from "@yomi/agent-core"
import { formatAgentSoul } from "@yomi/shared"
import {
  getAccessToken,
  listConnectedProviders,
} from "../services/integration-tokens.js"
import { hasBillablePlanAccess } from "../entitlements.js"
import { chargeUsage } from "../services/metering.js"
import * as authSchema from "../auth-schema.js"
import { upsertMemory } from "../routes/memory.js"

export interface RunAgentOptions {
  userId: string
  text: string
  history?: AgentMessage[]
  signal?: AbortSignal
  sourcePlatform?: string
  sourceChatId?: string
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
      trialEndDate: authSchema.user.trialEndDate,
      currentPeriodEnd: authSchema.user.currentPeriodEnd,
      agentSoul: authSchema.user.agentSoul,
    })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)
  return row ?? null
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
      const header = `[${i + 1}] ${row.sourceName}${row.title && row.title !== row.sourceName ? `: ${row.title}` : ""}`
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

async function fetchMemoryContext(userId: string, query: string, maxChars = 2000): Promise<string> {
  try {
    const safe = query.trim().slice(0, 400)
    if (!safe) return ""
    const rows = await db
      .select({
        kind: memoryEntries.kind,
        topic: memoryEntries.topic,
        content: memoryEntries.content,
        confidence: memoryEntries.confidence,
        sourcePath: memoryEntries.sourcePath,
      })
      .from(memoryEntries)
      .where(
        and(
          eq(memoryEntries.userId, userId),
          eq(memoryEntries.status, "active"),
          or(
            ilike(memoryEntries.topic, `%${safe}%`),
            ilike(memoryEntries.content, `%${safe}%`),
            ilike(memoryEntries.kind, `%${safe}%`),
            ilike(memoryEntries.scope, `%${safe}%`),
          ),
        ),
      )
      .orderBy(desc(memoryEntries.confidence), desc(memoryEntries.updatedAt))
      .limit(8)

    const out: string[] = []
    let used = 0
    for (const row of rows) {
      const snippet = `- [${row.kind}, confidence ${row.confidence}] ${row.topic}: ${row.content}${row.sourcePath ? ` (source: ${row.sourcePath})` : ""}`
      if (used + snippet.length > maxChars) break
      out.push(snippet)
      used += snippet.length
    }
    return out.join("\n")
  } catch {
    return ""
  }
}

async function fetchMemoryProfile(userId: string, maxChars = 2500): Promise<{ staticProfile: string; dynamicProfile: string }> {
  try {
    type Row = { content: string; summary: string | null; isStatic: boolean }
    const result = await db.execute(sql`
      select content, summary, is_static as "isStatic"
      from memory_entries
      where user_id = ${userId}
        and status = 'active'
        and is_latest = true
      order by is_static desc, confidence desc, updated_at desc
      limit 48
    `)
    const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Row[]
    const format = (title: string, isStatic: boolean) => {
      const out: string[] = []
      let used = 0
      for (const row of rows) {
        if (row.isStatic !== isStatic) continue
        const line = `- ${row.summary || row.content}`
        if (used + line.length > maxChars) break
        out.push(line)
        used += line.length
      }
      return out.length ? `${title}\n${out.join("\n")}` : ""
    }
    return { staticProfile: format("## Static Profile", true), dynamicProfile: format("## Dynamic Context", false) }
  } catch {
    return { staticProfile: "", dynamicProfile: "" }
  }
}

type ExtractedMemory = {
  kind?: string
  scope?: string
  topic?: string
  content?: string
  confidence?: number
  replaces_topic?: string
}

function parseExtractedMemories(text: string): ExtractedMemory[] {
  try {
    const parsed = JSON.parse(text) as { memories?: ExtractedMemory[] }
    return Array.isArray(parsed.memories) ? parsed.memories : []
  } catch {
    return []
  }
}

async function captureBackendMemory(userId: string, input: string, output: string): Promise<void> {
  if (!process.env["AI_CREDITS_API_KEY"] || process.env["YOMI_DISABLE_MEMORY_CAPTURE"] === "1") return
  const cleanInput = input.replace(/\r/g, "").slice(0, 1800).trim()
  const cleanOutput = output.replace(/\r/g, "").slice(0, 1800).trim()
  if (!cleanInput || !cleanOutput) return

  const { text } = await generateText({
    model: createModel(process.env["MEMORY_EXTRACTION_MODEL"] || process.env["AI_CREDITS_FAST_MODEL"] || "gpt-5.5-mini"),
    messages: [
      {
        role: "user",
        content: `Extract durable user memory from this Yomi backend-agent interaction.

Return strict JSON only:
{"memories":[{"kind":"preference|fact|project|decision|open_thread|correction","scope":"global|project|app|session","topic":"short key","content":"one concise memory","confidence":0.0,"replaces_topic":"optional old topic"}]}

Rules:
- Store only useful future context.
- Do not store secrets, passwords, API keys, or one-off trivia.
- Prefer high precision. If uncertain, omit it.
- Use replaces_topic only for clear corrections or updates.

User: ${cleanInput}
Assistant: ${cleanOutput}`,
      },
    ],
  })

  for (const memory of parseExtractedMemories(text)) {
    if (!memory.content || !memory.topic) continue
    await upsertMemory(userId, {
      kind: memory.kind || "fact",
      scope: memory.scope || "global",
      topic: memory.topic,
      content: memory.content,
      confidence: Math.round(Math.max(0, Math.min(1, memory.confidence ?? 0.7)) * 100),
      sourceType: "backend_agent_turn",
      isStatic: memory.kind === "preference" || memory.kind === "fact",
      replaces_topic: memory.replaces_topic,
    })
  }
}

function buildSystemWithContext(memoryContext: string, ragContext: string, profile?: { staticProfile: string; dynamicProfile: string }, desktopOnlyConnected: string[] = [], userSoul?: string | null): string {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const appUrl = process.env["YOMI_APP_URL"] ?? "https://yomi.arka6fx.com"
  // Prefer the user's onboarded personality; fall back to the global env soul, then
  // to the built-in default (handled by formatAgentSoul when undefined).
  const soul = userSoul?.trim() || process.env["YOMI_AGENT_SOUL"]
  return (
    `You are Yomi, a helpful AI assistant. Today is ${today}.\n` +
    `This is a chat/messaging interface, not a document. Keep replies as long as they need to be and no longer: answer directly, skip preamble, don't restate the question, and never pad to fill space. A sentence or two is usually plenty; use a few bullet points only when genuinely listing items, and expand only when the user asks for detail or the task truly needs it. Don't be curt either, just say what's useful.\n` +
    `Write the way a sharp, friendly person texts. Do not use em dashes or en dashes; use commas, periods, or parentheses instead.\n` +
    `${formatAgentSoul(soul)}\n\n` +
    `When the user asks about their email or connected apps, use the available tools to fetch real data before answering.\n` +
    `If a tool reports a service is not connected, suggest they connect it at ${appUrl}/dashboard.\n` +
    `If a tool returns an authorization or token error, suggest they reconnect at ${appUrl}/dashboard.\n` +
    (desktopOnlyConnected.length > 0
      ? `The user has connected these services that only work in the Yomi desktop app, not here: ${desktopOnlyConnected.join(", ")}. ` +
        `If they ask you to use one (e.g. running a database query), explain you can't access it from this chat and ask them to use the Yomi desktop app.\n`
      : "") +
    `\n` +
    (memoryContext || ragContext || profile?.staticProfile || profile?.dynamicProfile
      ? `<memory>\n` +
        `[System note: Background context retrieved from your notes. Treat as reference only, respond to the current user message.]\n\n` +
        (profile?.staticProfile ? `<static_profile>\n${profile.staticProfile}\n</static_profile>\n` : "") +
        (profile?.dynamicProfile ? `<dynamic_profile>\n${profile.dynamicProfile}\n</dynamic_profile>\n` : "") +
        (memoryContext ? `<durable_memories>\n${memoryContext}\n</durable_memories>\n` : "") +
        (ragContext ? `<cloud_rag_context>\n${ragContext}\n</cloud_rag_context>\n` : "") +
        `<citation_rule>When you use a fact from a numbered retrieved block above, cite its number inline as [1]. Only cite sources you actually used.</citation_rule>\n` +
        `</memory>`
      : "")
  )
}

function maxOutputTokensFor(text: string): number {
  const q = text.toLowerCase()
  if (/\b(write|draft|compose|essay|article|report|code|program|function|debug|detailed|step by step)\b/.test(q)) {
    return 750
  }
  if (/\b(summary|summarize|explain|compare|plan)\b/.test(q)) return 450
  return 280
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

  // Credits are the single gate: charge before doing any paid work. The helper
  // records the bot_message usage event and consumes the credit; if the balance
  // can't cover it (or the plan is inactive) we return the block message and bail.
  const charge = await chargeUsage({ user, kind: "bot_message" })
  if (!charge.ok) {
    return { text: charge.message, quotaError: true }
  }

  const registry = new ConnectorRegistry({
    // The backend agent runs on Cloudflare Workers, which can't run the raw-TCP
    // database drivers (pg/mysql2). Skip Node-only connectors so the agent never
    // offers a DB tool it can't execute — those work via the desktop sidecar.
    excludeNodeOnly: true,
    getAccessToken,
    createPendingAction: async (input) => {
      const { createPendingAction } = await import("../services/pending-actions.js")
      return createPendingAction({
        userId: opts.userId,
        sourcePlatform: opts.sourcePlatform,
        sourceChatId: opts.sourceChatId,
        ...input,
      })
    },
    listConnectedProviders: async (userId: string) => {
      return listConnectedProviders(userId)
    },
  })
  await registry.init(opts.userId)

  const appUrl = process.env["YOMI_APP_URL"] ?? "https://yomi.arka6fx.com"

  const [memoryContext, ragContext, profile] = await Promise.all([
    fetchMemoryContext(opts.userId, opts.text),
    fetchRagContext(opts.userId, opts.text),
    fetchMemoryProfile(opts.userId),
  ])

  let text: string
  try {
    text = await runAgentLoop({
      registry,
      text: opts.text,
      history: opts.history,
      system: buildSystemWithContext(memoryContext, ragContext, profile, registry.getDesktopOnlyConnected(), user.agentSoul),
      maxTokens: maxOutputTokensFor(opts.text),
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
      text = "Rate limit hit, please wait a moment and try again."
    } else if (/\b(timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|network)\b/i.test(msg)) {
      text = "Network error, couldn't reach a required service. Please try again."
    } else {
      text =
        `Something went wrong: ${msg.slice(0, 300)}\n\nPlease try again, or ` +
        `check your integrations at ${appUrl}/dashboard if this keeps happening.`
    }
  }

  await captureBackendMemory(opts.userId, opts.text, text).catch(() => {})

  // Usage was already recorded and credits consumed by chargeUsage() up front.
  return { text }
}
