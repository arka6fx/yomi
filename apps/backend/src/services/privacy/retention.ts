import { and, eq, lt, lte } from "drizzle-orm"
import { db, privacyAuditEvents, privacyDeletionJobs, privacyExports } from "@yomi/db"
import * as authSchema from "../../auth-schema.js"

export type RetentionReport = {
  expiredExports: number
  oldDeletionJobs: number
  hardDeletedUsers: number
  oldAuditEvents: number
}

export async function runPrivacyRetention(): Promise<RetentionReport> {
  const report: RetentionReport = {
    expiredExports: 0,
    oldDeletionJobs: 0,
    hardDeletedUsers: 0,
    oldAuditEvents: 0,
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
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const staleUsers = await db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(lt(authSchema.user.deletedAt, cutoff))
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

  return report
}
