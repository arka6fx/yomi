import { and, desc, eq, sql } from "drizzle-orm"
import { db, agentMessages, agentSessions } from "@yomi/db"
import type { AgentMessage } from "@yomi/agent-core"

const DEFAULT_HISTORY_TURNS = 12

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
}

export async function loadAgentHistory(sessionId: string, maxTurns = DEFAULT_HISTORY_TURNS): Promise<AgentMessage[]> {
  const rows = await db
    .select({ role: agentMessages.role, content: agentMessages.content, createdAt: agentMessages.createdAt })
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(desc(agentMessages.createdAt))
    .limit(maxTurns * 2)

  return rows
    .reverse()
    .filter((row): row is { role: AgentMessage["role"]; content: string; createdAt: Date } =>
      (row.role === "user" || row.role === "assistant" || row.role === "system") && row.content.trim().length > 0,
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
    { sessionId: input.sessionId, userId: input.userId, role: "user", content: input.userText, createdAt: now },
    { sessionId: input.sessionId, userId: input.userId, role: "assistant", content: input.assistantText, createdAt: now },
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
