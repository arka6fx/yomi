import { eq, sql } from "drizzle-orm"
import { generateText } from "ai"
import { db, ragSources, usageEvents } from "@yomi/db"
import {
  ConnectorRegistry,
  createModel,
  runAgentLoop,
  type AgentMessage,
  type UsageInfo,
} from "@yomi/agent-core"
import { formatAgentSoul } from "@yomi/shared"
import { compressContext, shouldCompress, estimateTokens } from "./compressor.js"
import { getAccessToken, listConnectedProviders } from "../services/integration-tokens.js"
import { hasBillablePlanAccess } from "../entitlements.js"
import { chargeUsage } from "../services/metering.js"
import { recordAiUsage } from "../services/ai-telemetry.js"
import { checkConsent } from "../services/privacy/checks.js"
import * as authSchema from "../auth-schema.js"
import { upsertMemory } from "../routes/memory.js"

export interface RunAgentOptions {
  userId: string
  text: string
  history?: AgentMessage[]
  signal?: AbortSignal
  sourcePlatform?: string
  sourceChatId?: string
  // Set when resuming a turn the user already paid for — approving a gated write
  // re-enters the loop so the agent can finish its plan, and billing that "yes" as
  // a fresh message would charge a multi-write task once per approval.
  skipCharge?: boolean
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
        and s.status in ('ready', 'active', 'backfilling')
        and c.content_tsv @@ websearch_to_tsquery('english', ${safe})
      order by ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', ${safe})) desc
      limit 5
    `)
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as Row[]
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

    const MEMORY_CANDIDATES = 30
    const MEMORY_RRF_K = 60

    const queryEmbedding = await embedTextLocal(safe).catch(() => [])
    const vecSql = queryEmbedding.length
      ? sql`
        vec as (
          select me.memory_id, row_number() over (order by me.embedding <=> ${vectorLiteralLocal(queryEmbedding)}::vector) as rnk
          from memory_embeddings me
          where me.user_id = ${userId}
          order by me.embedding <=> ${vectorLiteralLocal(queryEmbedding)}::vector
          limit ${MEMORY_CANDIDATES}
        ),`
      : sql`
        vec as (
          select null::uuid as memory_id, null::bigint as rnk
          where false
        ),`

    const result = await db.execute(sql`
      with ${vecSql}
      fts as (
        select e.id as memory_id,
               row_number() over (order by ts_rank_cd(e.content_tsv, websearch_to_tsquery('english', ${safe})) desc) as rnk
        from memory_entries e
        where e.user_id = ${userId}
          and e.status = 'active'
          and e.is_latest = true
          and e.content_tsv @@ websearch_to_tsquery('english', ${safe})
        limit ${MEMORY_CANDIDATES}
      ),
      meta as (
        select e.id as memory_id,
               row_number() over (order by e.is_static desc, e.confidence desc, e.updated_at desc) as rnk
        from memory_entries e
        where e.user_id = ${userId}
          and e.status = 'active'
          and e.is_latest = true
          and (
            e.topic ilike ${`%${safe}%`} or
            e.content ilike ${`%${safe}%`} or
            e.kind ilike ${`%${safe}%`} or
            e.scope ilike ${`%${safe}%`}
          )
        limit ${MEMORY_CANDIDATES}
      ),
      fused as (
        select memory_id,
               sum(1.0 / (${MEMORY_RRF_K} + rnk)) as score,
               array_agg(source) as matched_by
        from (
          select memory_id, rnk, 'vector'::text as source from vec where memory_id is not null
          union all
          select memory_id, rnk, 'full_text'::text as source from fts
          union all
          select memory_id, rnk, 'metadata'::text as source from meta
        ) u
        group by memory_id
        order by score desc
        limit 8
      )
      select
        e.kind as "kind",
        e.topic as "topic",
        e.content as "content",
        e.confidence as "confidence",
        e.source_path as "sourcePath",
        e.is_static as "isStatic",
        e.updated_at as "updatedAt",
        f.score as "score",
        f.matched_by as "matchedBy"
      from fused f
      join memory_entries e on e.id = f.memory_id
      order by e.is_static desc, f.score desc, e.confidence desc, e.updated_at desc
      limit 8
    `)
    type Row = {
      kind: string
      topic: string
      content: string
      confidence: number
      sourcePath: string | null
      isStatic: boolean
      updatedAt: string
      score: number
      matchedBy: string[]
    }
    const rows = ((result as unknown as { rows?: Row[] }).rows ?? []) as Row[]
    if (!rows.length) return ""

    const out: string[] = []
    let used = 0
    for (const row of rows) {
      const matched = row.matchedBy?.length ? ` (${row.matchedBy.join("+")})` : ""
      const snippet = `- [${row.kind}${matched}, confidence ${row.confidence}] ${row.topic}: ${row.content}${row.sourcePath ? ` (source: ${row.sourcePath})` : ""}`
      if (used + snippet.length > maxChars) break
      out.push(snippet)
      used += snippet.length
    }
    return out.join("\n")
  } catch {
    return ""
  }
}

function embedTextLocal(input: string): Promise<number[]> {
  const apiKey = process.env["OPENAI_API_KEY"]
  if (!apiKey || !input.trim()) return Promise.resolve([])
  const baseUrl = (process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1").replace(
    /\/+$/,
    "",
  )
  const model = process.env["OPENAI_EMBEDDING_MODEL"] ?? "text-embedding-3-small"
  return fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: input.trim() }),
  })
    .then((r) => r.json() as Promise<{ data?: { embedding?: number[] }[] }>)
    .then((body) => {
      const emb = body.data?.[0]?.embedding
      return Array.isArray(emb) && emb.length === 1536 ? emb : []
    })
}

function vectorLiteralLocal(values: number[]): string {
  return `[${values.map((v) => (Number.isFinite(v) ? v.toFixed(8) : "0")).join(",")}]`
}

async function fetchMemoryProfile(
  userId: string,
  maxChars = 2500,
): Promise<{ staticProfile: string; dynamicProfile: string }> {
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
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as Row[]
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
    return {
      staticProfile: format("## Static Profile", true),
      dynamicProfile: format("## Dynamic Context", false),
    }
  } catch {
    return { staticProfile: "", dynamicProfile: "" }
  }
}

async function fetchRecentChat(userId: string, maxTurns = 20): Promise<string> {
  try {
    type Row = { role: string; content: string }
    const result = await db.execute(sql`
      select role, content
      from agent_messages
      where user_id = ${userId}
        and (role = 'user' or role = 'assistant')
        and length(trim(content)) > 0
      order by created_at desc
      limit ${maxTurns * 2}
    `)
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as Row[]
    if (!rows.length) return ""
    return rows
      .reverse()
      .map((row) => (row.role === "user" ? `User: ${row.content}` : `Assistant: ${row.content}`))
      .join("\n")
  } catch {
    return ""
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
  if (!process.env["OPENAI_API_KEY"] || process.env["YOMI_DISABLE_MEMORY_CAPTURE"] === "1")
    return
  const cleanInput = input.replace(/\r/g, "").slice(0, 1800).trim()
  const cleanOutput = output.replace(/\r/g, "").slice(0, 1800).trim()
  if (!cleanInput || !cleanOutput) return

  const { text } = await generateText({
    model: createModel(
      process.env["MEMORY_EXTRACTION_MODEL"] ||
        process.env["OPENAI_FAST_MODEL"] ||
        "gpt-5.4-mini",
    ),
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

// Google Calendar knows the user's zone and nothing else does — we store no timezone.
// Cached to keep a Google round-trip off every message, but only briefly: a user who
// corrects a wrong calendar timezone (Google's default is UTC, so this happens) should
// see Yomi agree within minutes, not hours.
const TZ_CACHE_MS = 15 * 60 * 1000
const timeZoneCache = new Map<string, { tz: string | null; at: number }>()

async function resolveUserTimeZone(userId: string): Promise<string | null> {
  const hit = timeZoneCache.get(userId)
  if (hit && Date.now() - hit.at < TZ_CACHE_MS) return hit.tz

  let tz: string | null = null
  try {
    const token = await getAccessToken(userId, "google-calendar")
    if (token) {
      const res = await fetch(
        "https://www.googleapis.com/calendar/v3/users/me/settings/timezone",
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (res.ok) {
        const data = (await res.json()) as { value?: string }
        tz = data.value ?? null
      }
    }
  } catch {
    // best-effort — a missing timezone just falls back to the server clock
  }
  timeZoneCache.set(userId, { tz, at: Date.now() })
  return tz
}

export function buildSystemWithContext(
  memoryContext: string,
  ragContext: string,
  profile?: { staticProfile: string; dynamicProfile: string },
  desktopOnlyConnected: string[] = [],
  userSoul?: string | null,
  recentChat?: string,
  timeZone?: string | null,
): string {
  // The box runs UTC. Without the user's zone this said "today is the 11th" to
  // someone whose phone said the 12th, so "tomorrow at 4pm" booked yesterday —
  // wrong every evening after the UTC date rolls over.
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(timeZone ? { timeZone } : {}),
  })
  const appUrl = process.env["YOMI_APP_URL"] ?? "https://getyomi.in"
  // Prefer the user's onboarded personality; fall back to the global env soul, then
  // to the built-in default (handled by formatAgentSoul when undefined).
  const soul = userSoul?.trim() || process.env["YOMI_AGENT_SOUL"]
  return (
    `You are Yomi, a helpful AI assistant. Today is ${today}${
      timeZone
        ? ` in the user's timezone (${timeZone}), where it is currently ${new Date().toLocaleTimeString(
            "en-US",
            { hour: "numeric", minute: "2-digit", timeZone },
          )}. Resolve "today", "tomorrow" and any clock time against that, never against UTC`
        : ""
    }.\n` +
    `This is a chat/messaging interface, not a document. Keep replies as long as they need to be and no longer: answer directly, skip preamble, don't restate the question, and never pad to fill space. A sentence or two is usually plenty; use a few bullet points only when genuinely listing items, and expand only when the user asks for detail or the task truly needs it. Don't be curt either, just say what's useful.\n` +
    `Write the way a sharp, friendly person texts. Do not use em dashes or en dashes; use commas, periods, or parentheses instead.\n` +
    `${formatAgentSoul(soul)}\n\n` +
    `When the user asks about their email or connected apps, use the available tools to fetch real data before answering.\n` +
    `Actions and approvals: when the user asks you to create, send, edit, schedule, or delete something in a connected app, call the tool right away. Do NOT ask them to confirm first and do NOT wait for a "yes" before calling it — every such action is automatically held for the user's approval. An approval card showing the FULL details (recipients, subject, body, times) is sent to the user for you, so do not restate those details and do not summarise them away. After a tool reports an action is pending, say nothing more than a brief acknowledgement, or nothing at all — the card already asked them to reply "yes" or "no".\n` +
    `If a tool reports a service is not connected, suggest they connect it at ${appUrl}/dashboard.\n` +
    `If a tool returns an authorization or token error, suggest they reconnect at ${appUrl}/dashboard.\n` +
    (desktopOnlyConnected.length > 0
      ? `The user has connected these services that only work in the Yomi desktop app, not here: ${desktopOnlyConnected.join(", ")}. ` +
        `If they ask you to use one (e.g. running a database query), explain you can't access it from this chat and ask them to use the Yomi desktop app.\n`
      : "") +
    `\n` +
    (memoryContext || ragContext || profile?.staticProfile || profile?.dynamicProfile || recentChat
      ? `<memory>\n` +
        `[System note: Background context retrieved from your notes. Treat as reference only, respond to the current user message.]\n\n` +
        (profile?.staticProfile
          ? `<static_profile>\n${profile.staticProfile}\n</static_profile>\n`
          : "") +
        (profile?.dynamicProfile
          ? `<dynamic_profile>\n${profile.dynamicProfile}\n</dynamic_profile>\n`
          : "") +
        (memoryContext ? `<durable_memories>\n${memoryContext}\n</durable_memories>\n` : "") +
        (ragContext ? `<cloud_rag_context>\n${ragContext}\n</cloud_rag_context>\n` : "") +
        (recentChat ? `<recent_chat>\n${recentChat}\n</recent_chat>\n` : "") +
        `<citation_rule>When you use a fact from a numbered retrieved block above, cite its number inline as [1]. Only cite sources you actually used.</citation_rule>\n` +
        `</memory>`
      : "")
  )
}

function maxOutputTokensFor(text: string): number {
  const q = text.toLowerCase()
  // The agent model reasons before answering and its thinking tokens count
  // against this budget, and a short reply like "yes" inherits the pending
  // task's complexity — so the floor must stay high and never scale down.
  // Budgets below ~1k made the model finish with reason=length and zero
  // visible text ("I couldn't produce a reply") on every confirmation.
  let base: number
  if (
    /\b(gmail|email|inbox|calendar|schedule|drive|file|files|doc|docs|sheet|sheets|slide|slides|document|spreadsheet|classroom|github|slack|notion|linear)\b/.test(
      q,
    ) ||
    /\b(write|draft|compose|essay|article|report|code|program|function|debug|detailed|step by step)\b/.test(
      q,
    )
  ) {
    base = 4000
  } else {
    base = 2500
  }
  const scale = Math.min(1.5, Math.max(1, text.length / 500))
  return Math.round(base * scale)
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
  // A resumed turn is already paid for — see skipCharge.
  let usageEventId: string | null = null
  if (!opts.skipCharge) {
    const charge = await chargeUsage({ user, kind: "bot_message" })
    if (!charge.ok) {
      return { text: charge.message, quotaError: true }
    }
    usageEventId = charge.usageEventId ?? null
  }

  const registry = new ConnectorRegistry({
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

  const appUrl = process.env["YOMI_APP_URL"] ?? "https://getyomi.in"

  // A consent-store hiccup must degrade to "no memory context", not abort the
  // whole run — the reply is still useful without memory.
  const denied = { allowed: false, reason: "consent check failed", decided: false }
  const [memoryConsent, cloudMemoryConsent] = await Promise.all([
    checkConsent(opts.userId, "memory"),
    checkConsent(opts.userId, "cloud_memory"),
  ]).catch((err) => {
    console.error(
      "[runAgent] consent check failed:",
      err instanceof Error ? (err.stack ?? err.message) : err,
    )
    return [denied, denied]
  })

  const [memoryContext, ragContext, profile, recentChat] = await Promise.all([
    memoryConsent.allowed ? fetchMemoryContext(opts.userId, opts.text) : "",
    cloudMemoryConsent.allowed ? fetchRagContext(opts.userId, opts.text) : "",
    memoryConsent.allowed
      ? fetchMemoryProfile(opts.userId)
      : { staticProfile: "", dynamicProfile: "" },
    memoryConsent.allowed ? fetchRecentChat(opts.userId) : "",
  ])

  // Context compression: if the conversation history is large, summarise the
  // middle portion to stay within the model's context window.
  let history = opts.history
  const contextWindow = Number(process.env["YOMI_CONTEXT_WINDOW"] ?? 128_000)
  if (history && shouldCompress(history, contextWindow)) {
    console.warn(
      `[runAgent] compressing history (${history.length} messages, ~${estimateTokens(history)} tokens)`,
    )
    const compressed = await compressContext(history, contextWindow, {
      signal: opts.signal,
    }).catch<{ messages: AgentMessage[]; compressed: boolean }>(() => ({
      messages: history!,
      compressed: false,
    }))
    if (compressed.compressed) {
      console.warn(`[runAgent] compressed to ${compressed.messages.length} messages`)
      history = compressed.messages
    }
  }

  let text: string
  const startedAt = Date.now()
  const userTimeZone = await resolveUserTimeZone(opts.userId)
  try {
    text = await runAgentLoop({
      registry,
      text: opts.text,
      history,
      system: buildSystemWithContext(
        memoryContext,
        ragContext,
        profile,
        registry.getDesktopOnlyConnected(),
        user.agentSoul,
        recentChat,
        userTimeZone,
      ),
      maxTokens: maxOutputTokensFor(opts.text),
      signal: opts.signal,
      onUsage: (usage: UsageInfo) => {
        if (usageEventId) {
          db.update(usageEvents)
            .set({
              model: usage.model,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              metadata: {
                toolCallCount: usage.toolCallCount,
                finishReason: usage.finishReason,
              },
            })
            .where(eq(usageEvents.id, usageEventId))
            .catch(() => {})
        }

        recordAiUsage({
          userId: opts.userId,
          requestId: crypto.randomUUID(),
          usageEventId: usageEventId ?? null,
          endpoint: "backend.agent",
          surface: "telegram",
          route: "agent",
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs: Date.now() - startedAt,
          status: "done",
        }).catch(() => {})
      },
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

  if (memoryConsent.allowed) {
    await captureBackendMemory(opts.userId, opts.text, text).catch(() => {})
  }

  // Usage was already recorded and credits consumed by chargeUsage() up front.
  return { text }
}
