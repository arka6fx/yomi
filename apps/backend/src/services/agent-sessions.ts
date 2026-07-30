import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm"
import { generateObject, jsonSchema } from "ai"
import { db, agentMessages, agentSessions } from "@yomi/db"
import { createModel, type AgentMessage, type SessionRecallResult } from "@yomi/agent-core"

const DEFAULT_HISTORY_TURNS = 12
const RECALL_RRF_K = 60
const RECALL_CANDIDATES = 30

export interface AgentSessionRef {
  id: string
  messageCount: number
}

export async function getOrCreateAgentSession(input: {
  userId: string
  platform: string
  chatId: string
}): Promise<AgentSessionRef> {
  const existing = await db
    .select({ id: agentSessions.id, messageCount: agentSessions.messageCount })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.userId, input.userId),
        eq(agentSessions.platform, input.platform),
        eq(agentSessions.chatId, input.chatId),
        eq(agentSessions.status, "active"),
      ),
    )
    .orderBy(desc(agentSessions.lastMessageAt))
    .limit(1)
    .then((rows) => rows[0])

  if (existing) return existing

  try {
    const [created] = await db
      .insert(agentSessions)
      .values({
        userId: input.userId,
        platform: input.platform,
        chatId: input.chatId,
      })
      .returning({ id: agentSessions.id, messageCount: agentSessions.messageCount })
    if (created) return created
  } catch {
    const raced = await db
      .select({ id: agentSessions.id, messageCount: agentSessions.messageCount })
      .from(agentSessions)
      .where(
        and(
          eq(agentSessions.userId, input.userId),
          eq(agentSessions.platform, input.platform),
          eq(agentSessions.chatId, input.chatId),
          eq(agentSessions.status, "active"),
        ),
      )
      .orderBy(desc(agentSessions.lastMessageAt))
      .limit(1)
      .then((rows) => rows[0])
    if (raced) return raced
  }

  throw new Error("Failed to create agent session")
}

export async function closeAgentSession(input: {
  userId: string
  platform: string
  chatId: string
}): Promise<void> {
  const sessions = await db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.userId, input.userId),
        eq(agentSessions.platform, input.platform),
        eq(agentSessions.chatId, input.chatId),
        eq(agentSessions.status, "active"),
      ),
    )
    .limit(1)

  await db
    .update(agentSessions)
    .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(agentSessions.userId, input.userId),
        eq(agentSessions.platform, input.platform),
        eq(agentSessions.chatId, input.chatId),
        eq(agentSessions.status, "active"),
      ),
    )

  const session = sessions[0]
  if (session) {
    summarizeSession(session.id).catch((err) => {
      console.warn(
        `[agent-sessions] summarization failed for ${session.id}: ${err instanceof Error ? err.message : String(err)}`,
      )
    })
  }
}

export async function summarizeSession(sessionId: string): Promise<void> {
  const messages = await db
    .select({ role: agentMessages.role, content: agentMessages.content })
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(asc(agentMessages.createdAt))

  const userMsgs = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .filter(Boolean)
  const assistantMsgs = messages
    .filter((m) => m.role === "assistant")
    .map((m) => m.content)
    .filter(Boolean)
  if (userMsgs.length === 0 && assistantMsgs.length === 0) return

  const conversation = [
    "--- User messages ---",
    ...userMsgs.slice(-20).map((c) => c.slice(0, 800)),
    "--- Assistant messages ---",
    ...assistantMsgs.slice(-20).map((c) => c.slice(0, 800)),
  ].join("\n")

  const modelId = process.env["OPENAI_FAST_MODEL"] || "gpt-5.4-mini"

  const { object } = await generateObject({
    model: createModel(modelId),
    schema: jsonSchema<{ title: string; summary: string }>({
      type: "object",
      additionalProperties: false,
      required: ["title", "summary"],
      properties: {
        title: { type: "string", description: "Short title for this conversation (max 8 words)" },
        summary: {
          type: "string",
          description:
            "2-3 sentence summary of key decisions, facts, and user preferences revealed",
        },
      },
    }),
    system:
      "You summarize chat conversations between a user and an AI assistant. " +
      "Produce a short title (max 8 words) and a 2-3 sentence summary capturing " +
      "key decisions, facts revealed, and user preferences. Be concise.",
    prompt: `Summarize this conversation:\n\n${conversation}`,
  })

  await db
    .update(agentSessions)
    .set({ title: object.title, summary: object.summary, updatedAt: new Date() })
    .where(eq(agentSessions.id, sessionId))
}

export async function summarizeUnsummarizedSessions(batchSize = 25): Promise<number> {
  const rows = await db
    .select({ id: agentSessions.id })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.status, "closed"),
        isNotNull(agentSessions.closedAt),
        sql`${agentSessions.title} IS NULL`,
      ),
    )
    .orderBy(desc(agentSessions.closedAt))
    .limit(batchSize)

  let count = 0
  for (const row of rows) {
    try {
      await summarizeSession(row.id)
      count++
    } catch (err) {
      console.warn(
        `[agent-sessions] backfill summarization failed for ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  return count
}

export async function searchSessions(
  userId: string,
  query: string,
  limit = 5,
): Promise<SessionRecallResult[]> {
  const safe = query.trim().slice(0, 500)
  if (!safe) return []

  type SessionRow = {
    id: string
    title: string | null
    summary: string | null
    messageCount: number
    closedAt: string | null
    score: number
  }

  const fused = await db.execute(sql`
    WITH fts AS (
      SELECT id,
             row_number() OVER (ORDER BY ts_rank_cd("summary_tsv", websearch_to_tsquery('english', ${safe})) DESC) AS rnk
      FROM ${agentSessions}
      WHERE user_id = ${userId}
        AND status = 'closed'
        AND "summary_tsv" @@ websearch_to_tsquery('english', ${safe})
      LIMIT ${RECALL_CANDIDATES}
    ),
    msg AS (
      SELECT m.session_id AS id,
             row_number() OVER (ORDER BY count(*) DESC) AS rnk
      FROM ${agentMessages} m
      WHERE m.user_id = ${userId}
        AND to_tsvector('english', m.content) @@ websearch_to_tsquery('english', ${safe})
      GROUP BY m.session_id
      LIMIT ${RECALL_CANDIDATES}
    ),
    fused AS (
      SELECT id, SUM(1.0 / (${RECALL_RRF_K} + rnk)) AS score
      FROM (
        SELECT id, rnk FROM fts
        UNION ALL
        SELECT id, rnk FROM msg
      ) u
      GROUP BY id
      ORDER BY score DESC
      LIMIT ${limit}
    )
    SELECT s.id, s.title, s.summary, s.message_count AS "messageCount", s.closed_at::text AS "closedAt", f.score
    FROM fused f
    JOIN ${agentSessions} s ON s.id = f.id
    ORDER BY f.score DESC
    LIMIT ${limit}
  `)

  const rows = (
    Array.isArray(fused) ? fused : ((fused as { rows?: unknown[] }).rows ?? [])
  ) as SessionRow[]

  const results: SessionRecallResult[] = await Promise.all(
    rows.map(async (row) => {
      const msgRows = await db
        .select({
          role: agentMessages.role,
          content: agentMessages.content,
          createdAt: agentMessages.createdAt,
        })
        .from(agentMessages)
        .where(eq(agentMessages.sessionId, row.id))
        .orderBy(desc(agentMessages.createdAt))
        .limit(6)

      return {
        sessionId: row.id,
        title: row.title,
        summary: row.summary,
        messageCount: row.messageCount,
        closedAt: row.closedAt,
        relevance: Math.round(row.score * 100) / 100,
        matchedMessages: msgRows
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(0, 4)
          .map((m) => ({
            role: m.role as "user" | "assistant",
            contentPreview: m.content.slice(0, 200),
            createdAt: m.createdAt.toISOString(),
          })),
      }
    }),
  )

  return results
}

export async function loadAgentHistory(
  sessionId: string,
  maxTurns = DEFAULT_HISTORY_TURNS,
): Promise<AgentMessage[]> {
  const rows = await db
    .select({
      role: agentMessages.role,
      content: agentMessages.content,
      createdAt: agentMessages.createdAt,
    })
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(desc(agentMessages.createdAt))
    .limit(maxTurns * 2)

  return rows
    .reverse()
    .filter(
      (row): row is { role: AgentMessage["role"]; content: string; createdAt: Date } =>
        (row.role === "user" || row.role === "assistant" || row.role === "system") &&
        row.content.trim().length > 0,
    )
    .map((row) => ({ role: row.role, content: row.content }))
}

export async function appendAgentTurn(input: {
  sessionId: string
  userId: string
  userText: string
  assistantText: string
}): Promise<void> {
  const now = new Date()
  await db.insert(agentMessages).values([
    {
      sessionId: input.sessionId,
      userId: input.userId,
      role: "user",
      content: input.userText,
      createdAt: now,
    },
    {
      sessionId: input.sessionId,
      userId: input.userId,
      role: "assistant",
      content: input.assistantText,
      createdAt: now,
    },
  ])
  await db
    .update(agentSessions)
    .set({
      messageCount: sql`${agentSessions.messageCount} + 2`,
      lastMessageAt: now,
      updatedAt: now,
    })
    .where(eq(agentSessions.id, input.sessionId))
}
