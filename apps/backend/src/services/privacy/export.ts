import { eq, desc } from "drizzle-orm"
import { db, privacyExports } from "@yomi/db"
import {
  agentMessages,
  memoryEntries,
  ragSources,
  mcpConnections,
  platformConnections,
  schedules,
  usageEvents,
} from "@yomi/db"
import * as authSchema from "../../auth-schema.js"

export type ExportFormat = "json"

type DataInventory = {
  profile: Record<string, unknown>
  sessions: Record<string, unknown>[]
  accounts: Record<string, unknown>[]
  conversations: Record<string, unknown>[]
  memories: Record<string, unknown>[]
  ragSources: Record<string, unknown>[]
  connectors: Record<string, unknown>[]
  platforms: Record<string, unknown>[]
  schedules: Record<string, unknown>[]
  usage: Record<string, unknown>[]
}

export async function buildManifest(userId: string): Promise<DataInventory> {
  const [userRow] = await db
    .select({
      id: authSchema.user.id,
      email: authSchema.user.email,
      name: authSchema.user.name,
      plan: authSchema.user.plan,
      role: authSchema.user.role,
      subscriptionStatus: authSchema.user.subscriptionStatus,
      createdAt: authSchema.user.createdAt,
      consentVersion: authSchema.user.consentVersion,
      consentTimestamp: authSchema.user.consentTimestamp,
    })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)

  const [
    sessions,
    accounts,
    conversations,
    memories,
    ragSourceRows,
    connectorRows,
    platformRows,
    scheduleRows,
    usageRows,
  ] = await Promise.all([
    db.select({ id: authSchema.session.id, createdAt: authSchema.session.createdAt })
      .from(authSchema.session)
      .where(eq(authSchema.session.userId, userId)),
    db.select({
      id: authSchema.account.id,
      providerId: authSchema.account.providerId,
      scope: authSchema.account.scope,
    }).from(authSchema.account).where(eq(authSchema.account.userId, userId)),
    db.select({
      id: agentMessages.id,
      sessionId: agentMessages.sessionId,
      role: agentMessages.role,
      content: agentMessages.content,
      createdAt: agentMessages.createdAt,
    })
      .from(agentMessages)
      .where(eq(agentMessages.userId, userId))
      .orderBy(desc(agentMessages.createdAt))
      .limit(500),
    db.select({
      id: memoryEntries.id,
      kind: memoryEntries.kind,
      topic: memoryEntries.topic,
      summary: memoryEntries.summary,
      content: memoryEntries.content,
      status: memoryEntries.status,
      confidence: memoryEntries.confidence,
      createdAt: memoryEntries.createdAt,
    })
      .from(memoryEntries)
      .where(eq(memoryEntries.userId, userId))
      .orderBy(desc(memoryEntries.createdAt))
      .limit(1000),
    db.select({
      id: ragSources.id,
      name: ragSources.name,
      sourceType: ragSources.sourceType,
      status: ragSources.status,
      createdAt: ragSources.createdAt,
    })
      .from(ragSources)
      .where(eq(ragSources.userId, userId))
      .limit(500),
    db.select({
      id: mcpConnections.id,
      provider: mcpConnections.provider,
      scopes: mcpConnections.scopes,
      displayName: mcpConnections.displayName,
      createdAt: mcpConnections.createdAt,
    })
      .from(mcpConnections)
      .where(eq(mcpConnections.userId, userId)),
    db.select({
      platform: platformConnections.platform,
      connectedAt: platformConnections.connectedAt,
    })
      .from(platformConnections)
      .where(eq(platformConnections.userId, userId)),
    db.select({
      id: schedules.id,
      schedule: schedules.schedule,
      scheduleType: schedules.scheduleType,
      prompt: schedules.prompt,
      enabled: schedules.enabled,
      createdAt: schedules.createdAt,
    })
      .from(schedules)
      .where(eq(schedules.userId, userId)),
    db.select({
      id: usageEvents.id,
      kind: usageEvents.kind,
      costCents: usageEvents.costCents,
      creditsCharged: usageEvents.creditsCharged,
      createdAt: usageEvents.createdAt,
    })
      .from(usageEvents)
      .where(eq(usageEvents.userId, userId))
      .orderBy(desc(usageEvents.createdAt))
      .limit(1000),
  ])

  return {
    profile: userRow ?? {},
    sessions: sessions.map((s) => ({ id: s.id, createdAt: s.createdAt })),
    accounts: accounts as Record<string, unknown>[],
    conversations: conversations as Record<string, unknown>[],
    memories: memories as Record<string, unknown>[],
    ragSources: ragSourceRows as Record<string, unknown>[],
    connectors: connectorRows as Record<string, unknown>[],
    platforms: platformRows as Record<string, unknown>[],
    schedules: scheduleRows as Record<string, unknown>[],
    usage: usageRows as Record<string, unknown>[],
  }
}

export async function requestExport(userId: string, format: ExportFormat = "json") {
  const [existing] = await db
    .select()
    .from(privacyExports)
    .where(eq(privacyExports.userId, userId))
    .orderBy(desc(privacyExports.requestedAt))
    .limit(1)
  if (existing?.status === "queued" || existing?.status === "processing") {
    return existing
  }

  const [row] = await db
    .insert(privacyExports)
    .values({ userId, format, status: "processing" })
    .returning()
  if (!row) return null

  try {
    const manifest = await buildManifest(userId)
    const [updated] = await db
      .update(privacyExports)
      .set({
        status: "completed",
        manifest,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .where(eq(privacyExports.id, row.id))
      .returning()
    return updated
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const [updated] = await db
      .update(privacyExports)
      .set({ status: "failed", error: msg })
      .where(eq(privacyExports.id, row.id))
      .returning()
    return updated
  }
}

export async function getExport(userId: string, exportId: string) {
  const [row] = await db
    .select()
    .from(privacyExports)
    .where(eq(privacyExports.id, exportId))
    .limit(1)
  if (!row || row.userId !== userId) return null
  return row
}

export async function listExports(userId: string) {
  return await db
    .select({
      id: privacyExports.id,
      status: privacyExports.status,
      format: privacyExports.format,
      error: privacyExports.error,
      requestedAt: privacyExports.requestedAt,
      completedAt: privacyExports.completedAt,
      expiresAt: privacyExports.expiresAt,
    })
    .from(privacyExports)
    .where(eq(privacyExports.userId, userId))
    .orderBy(desc(privacyExports.requestedAt))
}
