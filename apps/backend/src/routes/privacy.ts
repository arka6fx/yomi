import { Hono } from "hono"
import { desc, eq, sql } from "drizzle-orm"
import {
  PRIVACY_CONSENT_PURPOSES,
  PRIVACY_POLICY_VERSION,
  TERMS_VERSION,
  isPrivacyConsentPurpose,
  type PrivacyConsentPurpose,
} from "@yomi/shared/privacy"
import {
  agentMessages,
  agentSessions,
  db,
  mcpConnections,
  memoryEntries,
  platformConnections,
  privacyAuditEvents,
  ragChunks,
  ragSources,
  schedules,
  usageEvents,
} from "@yomi/db"
import { authenticate } from "../auth.js"
import { clientIp, listPrivacyActivity, recordPrivacyAuditEvent, userAgent } from "../services/privacy/audit.js"
import { getConsentSnapshot, listConsentHistory, recordConsentDecision } from "../services/privacy/consent.js"
import { getPrivacyPreferences, updatePrivacyPreferences, type PrivacyPreferencePatch } from "../services/privacy/preferences.js"
import { getExport, listExports, requestExport } from "../services/privacy/export.js"
import { deleteMyData, deleteAccount, getDeletionJob, listDeletionJobs } from "../services/privacy/deletion.js"

type ConsentBody = {
  purposes?: unknown
  appVersion?: unknown
}

type PreferencesBody = Partial<Record<keyof PrivacyPreferencePatch, unknown>>

export const privacyRouter = new Hono()

privacyRouter.use("*", authenticate)

function normalizePurposes(value: unknown): PrivacyConsentPurpose[] {
  if (!Array.isArray(value)) return []
  const purposes: PrivacyConsentPurpose[] = []
  for (const item of value) {
    if (typeof item === "string" && isPrivacyConsentPurpose(item) && !purposes.includes(item)) {
      purposes.push(item)
    }
  }
  return purposes
}

function boolPatch(body: PreferencesBody): PrivacyPreferencePatch {
  const patch: PrivacyPreferencePatch = {}
  const booleanKeys = [
    "conversationHistoryEnabled",
    "memoryEnabled",
    "cloudMemoryEnabled",
    "connectorsEnabled",
    "analyticsEnabled",
    "voiceProcessingEnabled",
    "screenProcessingEnabled",
    "aiImprovementEnabled",
  ] as const
  for (const key of booleanKeys) {
    if (typeof body[key] === "boolean") patch[key] = body[key]
  }
  if (body.retentionOverrides && typeof body.retentionOverrides === "object" && !Array.isArray(body.retentionOverrides)) {
    patch.retentionOverrides = body.retentionOverrides as Record<string, unknown>
  }
  if (body.retentionOverrides === null) patch.retentionOverrides = null
  return patch
}

function clampLimit(value: string | undefined, fallback: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, max)
}

privacyRouter.get("/consents", async (c) => {
  const user = c.get("user")
  const [current, history] = await Promise.all([
    getConsentSnapshot(user.id),
    listConsentHistory(user.id),
  ])
  return c.json({
    versions: {
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      termsVersion: TERMS_VERSION,
    },
    purposes: PRIVACY_CONSENT_PURPOSES,
    current,
    history,
  })
})

privacyRouter.post("/consents", async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as ConsentBody
  const purposes = normalizePurposes(body.purposes)
  if (!purposes.length) return c.json({ error: "At least one valid consent purpose is required" }, 400)
  const current = await recordConsentDecision({
    userId: user.id,
    purposes,
    status: "granted",
    context: {
      appVersion: typeof body.appVersion === "string" ? body.appVersion : null,
      ipAddress: clientIp(c),
      userAgent: userAgent(c),
      metadata: { source: "dashboard" },
    },
  })
  await recordPrivacyAuditEvent({
    actorUserId: user.id,
    targetUserId: user.id,
    eventType: "privacy.consent.granted",
    ipAddress: clientIp(c),
    userAgent: userAgent(c),
    metadata: { purposes },
  })
  return c.json({ current })
})

privacyRouter.post("/consents/revoke", async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as ConsentBody
  const purposes = normalizePurposes(body.purposes)
  if (!purposes.length) return c.json({ error: "At least one valid consent purpose is required" }, 400)
  const current = await recordConsentDecision({
    userId: user.id,
    purposes,
    status: "revoked",
    context: {
      appVersion: typeof body.appVersion === "string" ? body.appVersion : null,
      ipAddress: clientIp(c),
      userAgent: userAgent(c),
      metadata: { source: "dashboard" },
    },
  })
  await recordPrivacyAuditEvent({
    actorUserId: user.id,
    targetUserId: user.id,
    eventType: "privacy.consent.revoked",
    ipAddress: clientIp(c),
    userAgent: userAgent(c),
    metadata: { purposes },
  })
  return c.json({ current })
})

privacyRouter.get("/preferences", async (c) => {
  const user = c.get("user")
  return c.json({ preferences: await getPrivacyPreferences(user.id) })
})

privacyRouter.patch("/preferences", async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as PreferencesBody
  const patch = boolPatch(body)
  if (!Object.keys(patch).length) return c.json({ error: "No valid privacy preferences provided" }, 400)
  const preferences = await updatePrivacyPreferences(user.id, patch)
  await recordPrivacyAuditEvent({
    actorUserId: user.id,
    targetUserId: user.id,
    eventType: "privacy.preferences.updated",
    ipAddress: clientIp(c),
    userAgent: userAgent(c),
    metadata: { changed: Object.keys(patch) },
  })
  return c.json({ preferences })
})

privacyRouter.get("/overview", async (c) => {
  const user = c.get("user")
  const [preferences, currentConsents, activity, counts] = await Promise.all([
    getPrivacyPreferences(user.id),
    getConsentSnapshot(user.id),
    listPrivacyActivity(user.id, 8),
    Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(agentSessions).where(eq(agentSessions.userId, user.id)),
      db.select({ count: sql<number>`count(*)` }).from(agentMessages).where(eq(agentMessages.userId, user.id)),
      db.select({ count: sql<number>`count(*)` }).from(memoryEntries).where(eq(memoryEntries.userId, user.id)),
      db.select({ count: sql<number>`count(*)` }).from(ragSources).where(eq(ragSources.userId, user.id)),
      db.select({ count: sql<number>`count(*)` }).from(ragChunks).where(eq(ragChunks.userId, user.id)),
      db.select({ count: sql<number>`count(*)` }).from(mcpConnections).where(eq(mcpConnections.userId, user.id)),
      db.select({ count: sql<number>`count(*)` }).from(platformConnections).where(eq(platformConnections.userId, user.id)),
      db.select({ count: sql<number>`count(*)` }).from(schedules).where(eq(schedules.userId, user.id)),
      db.select({ count: sql<number>`count(*)` }).from(usageEvents).where(eq(usageEvents.userId, user.id)),
    ]).then((rows) => rows.map((row) => Number(row[0]?.count ?? 0))),
  ])
  const [sessions, messages, memories, ragSourcesCount, ragChunksCount, connectors, platforms, schedulesCount, usage] = counts
  return c.json({
    preferences,
    consents: currentConsents,
    dataStored: {
      conversations: { sessions, messages },
      memories,
      rag: { sources: ragSourcesCount, chunks: ragChunksCount },
      connectors,
      platforms,
      schedules: schedulesCount,
      usageEvents: usage,
    },
    recentActivity: activity,
  })
})

privacyRouter.post("/exports", async (c) => {
  const user = c.get("user")
  const result = await requestExport(user.id)
  await recordPrivacyAuditEvent({
    actorUserId: user.id,
    targetUserId: user.id,
    eventType: "privacy.export.requested",
    ipAddress: clientIp(c),
    userAgent: userAgent(c),
  })
  return c.json({ export: result })
})

privacyRouter.get("/exports", async (c) => {
  const user = c.get("user")
  const exports = await listExports(user.id)
  return c.json({ exports })
})

privacyRouter.get("/exports/:id", async (c) => {
  const user = c.get("user")
  const exportRow = await getExport(user.id, c.req.param("id"))
  if (!exportRow) return c.json({ error: "Export not found" }, 404)
  return c.json({ export: exportRow })
})

privacyRouter.get("/activity", async (c) => {
  const user = c.get("user")
  const limit = clampLimit(c.req.query("limit"), 25, 100)
  const rows = await db
    .select({
      id: privacyAuditEvents.id,
      eventType: privacyAuditEvents.eventType,
      resourceType: privacyAuditEvents.resourceType,
      resourceId: privacyAuditEvents.resourceId,
      metadata: privacyAuditEvents.metadata,
      createdAt: privacyAuditEvents.createdAt,
    })
    .from(privacyAuditEvents)
    .where(eq(privacyAuditEvents.targetUserId, user.id))
    .orderBy(desc(privacyAuditEvents.createdAt))
    .limit(limit)
  return c.json({ activity: rows })
})

privacyRouter.post("/delete-data", async (c) => {
  const user = c.get("user")
  const job = await deleteMyData(user.id)
  await recordPrivacyAuditEvent({
    actorUserId: user.id,
    targetUserId: user.id,
    eventType: "privacy.delete_data.requested",
    ipAddress: clientIp(c),
    userAgent: userAgent(c),
  })
  if (!job) return c.json({ error: "Failed to create deletion job" }, 500)
  return c.json({ job })
})

privacyRouter.get("/delete-data", async (c) => {
  const user = c.get("user")
  const jobs = await listDeletionJobs(user.id)
  return c.json({ jobs })
})

privacyRouter.get("/delete-data/:id", async (c) => {
  const user = c.get("user")
  const job = await getDeletionJob(user.id, c.req.param("id"))
  if (!job) return c.json({ error: "Deletion job not found" }, 404)
  return c.json({ job })
})

privacyRouter.post("/delete-account", async (c) => {
  const user = c.get("user")
  await recordPrivacyAuditEvent({
    actorUserId: user.id,
    targetUserId: user.id,
    eventType: "privacy.delete_account.requested",
    ipAddress: clientIp(c),
    userAgent: userAgent(c),
  })
  const job = await deleteAccount(user.id)
  if (!job) return c.json({ error: "Failed to create deletion job" }, 500)
  return c.json({ job })
})
