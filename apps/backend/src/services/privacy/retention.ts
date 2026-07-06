import { and, eq, lt, lte } from "drizzle-orm"
import {
  agentMessages,
  agentSessions,
  db,
  deviceCodes,
  devices,
  linkingCodes,
  pendingActions,
  privacyAuditEvents,
  privacyDeletionJobs,
  privacyExports,
  ragRetrievalLogs,
  telegramLinkTokens,
  usageEvents,
} from "@yomi/db"
import { RETENTION_DEFAULTS, type RetentionDomainKey } from "@yomi/shared/privacy"
import * as authSchema from "../../auth-schema.js"

export type RetentionReport = {
  expiredExports: number
  oldDeletionJobs: number
  hardDeletedUsers: number
  oldAuditEvents: number
  domains: Record<RetentionDomainKey, number>
}

function cutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

export async function runPrivacyRetention(): Promise<RetentionReport> {
  const report: RetentionReport = {
    expiredExports: 0,
    oldDeletionJobs: 0,
    hardDeletedUsers: 0,
    oldAuditEvents: 0,
    domains: {
      conversations: 0,
      rag_retrieval_logs: 0,
      usage_events: 0,
      pending_actions: 0,
      devices: 0,
      expired_codes: 0,
    },
  }

  // 1. Delete expired privacy exports (7-day retention)
  report.expiredExports = (
    await db
      .delete(privacyExports)
      .where(and(lt(privacyExports.expiresAt, new Date()), eq(privacyExports.status, "completed")))
      .returning({ id: privacyExports.id })
  ).length

  // 2. Delete completed deletion jobs older than 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  report.oldDeletionJobs = (
    await db
      .delete(privacyDeletionJobs)
      .where(
        and(
          lte(privacyDeletionJobs.completedAt, thirtyDaysAgo),
          eq(privacyDeletionJobs.status, "completed"),
        ),
      )
      .returning({ id: privacyDeletionJobs.id })
  ).length

  // 3. Hard-delete user accounts soft-deleted > 30 days ago.
  // DB-level ON DELETE CASCADE cleans up remaining rows in dependent tables.
  const staleUserCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const staleUsers = await db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(lt(authSchema.user.deletedAt, staleUserCutoff))
  if (staleUsers.length > 0) {
    for (const u of staleUsers) {
      await db.delete(authSchema.user).where(eq(authSchema.user.id, u.id))
    }
    report.hardDeletedUsers = staleUsers.length
  }

  // 4. Delete audit events older than 90 days
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  report.oldAuditEvents = (
    await db
      .delete(privacyAuditEvents)
      .where(lt(privacyAuditEvents.createdAt, ninetyDaysAgo))
      .returning({ id: privacyAuditEvents.id })
  ).length

  // ── Domain retention sweeps (spec 23 §13.1) ─────────────────────────
  // Each sweep is isolated: a failure in one domain (e.g. a FK violation)
  // must not prevent the remaining sweeps or the audit insert from running.
  try {
    const conversationCutoff = cutoff(RETENTION_DEFAULTS.conversations.days)
    report.domains.conversations = (
      await db
        .delete(agentMessages)
        .where(lt(agentMessages.createdAt, conversationCutoff))
        .returning({ id: agentMessages.id })
    ).length
    // Sessions with no activity past the window (messages above are already gone).
    await db
      .delete(agentSessions)
      .where(lt(agentSessions.lastMessageAt, conversationCutoff))
      .returning({ id: agentSessions.id })
  } catch (err) {
    console.warn(`[retention] conversations sweep failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    report.domains.rag_retrieval_logs = (
      await db
        .delete(ragRetrievalLogs)
        .where(lt(ragRetrievalLogs.createdAt, cutoff(RETENTION_DEFAULTS.rag_retrieval_logs.days)))
        .returning({ id: ragRetrievalLogs.id })
    ).length
  } catch (err) {
    console.warn(`[retention] rag_retrieval_logs sweep failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    report.domains.usage_events = (
      await db
        .delete(usageEvents)
        .where(lt(usageEvents.createdAt, cutoff(RETENTION_DEFAULTS.usage_events.days)))
        .returning({ id: usageEvents.id })
    ).length
  } catch (err) {
    console.warn(`[retention] usage_events sweep failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    // Pending actions: expired + grace window (spec: expiry plus 7 days).
    report.domains.pending_actions = (
      await db
        .delete(pendingActions)
        .where(lt(pendingActions.expiresAt, cutoff(RETENTION_DEFAULTS.pending_actions.days)))
        .returning({ id: pendingActions.id })
    ).length
  } catch (err) {
    console.warn(`[retention] pending_actions sweep failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    report.domains.devices = (
      await db
        .delete(devices)
        .where(lt(devices.lastSeen, cutoff(RETENTION_DEFAULTS.devices.days)))
        .returning({ id: devices.id })
    ).length
  } catch (err) {
    console.warn(`[retention] devices sweep failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    const now = cutoff(RETENTION_DEFAULTS.expired_codes.days)
    const expiredCodes =
      (
        await db
          .delete(linkingCodes)
          .where(lt(linkingCodes.expiresAt, now))
          .returning({ code: linkingCodes.code })
      ).length +
      (
        await db
          .delete(telegramLinkTokens)
          .where(lt(telegramLinkTokens.expiresAt, now))
          .returning({ token: telegramLinkTokens.token })
      ).length +
      (
        await db
          .delete(deviceCodes)
          .where(lt(deviceCodes.expiresAt, now))
          .returning({ deviceCode: deviceCodes.deviceCode })
      ).length
    report.domains.expired_codes = expiredCodes
  } catch (err) {
    console.warn(`[retention] expired_codes sweep failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Counts-only audit trail entry — never persist row content.
  try {
    await db.insert(privacyAuditEvents).values({
      eventType: "privacy.retention.completed",
      metadata: { ...report.domains, exports: report.expiredExports },
    })
  } catch {
    // best-effort
  }

  return report
}
