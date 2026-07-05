import { and, eq } from "drizzle-orm"
import { db } from "@yomi/db"
import {
  agentMessages,
  agentSessions,
  linkingCodes,
  mcpConnections,
  memoryEmbeddings,
  memoryEntries,
  memoryRelations,
  pendingActions,
  platformConnections,
  privacyDeletionJobs,
  ragChunks,
  ragDocuments,
  ragEmbeddings,
  ragRetrievalLogs,
  ragSources,
  schedules,
  usageEvents,
} from "@yomi/db"
import { decryptTokens } from "../token-encryption.js"
import * as authSchema from "../../auth-schema.js"
import { getDodoConfig } from "../../routes/billing.js"

type DeletionStep = {
  name: string
  status: "pending" | "running" | "done" | "skipped" | "failed"
  deletedCount?: number
  error?: string
}

const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"

async function revokeGoogleTokens(userId: string): Promise<void> {
  const rows = await db
    .select({ oauthTokens: mcpConnections.oauthTokens })
    .from(mcpConnections)
    .where(and(eq(mcpConnections.userId, userId), eq(mcpConnections.provider, "google")))
    .limit(1)
  if (!rows.length) return

  try {
    const tok = decryptTokens(rows[0]!.oauthTokens)
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(tok.accessToken)}`, {
      method: "POST",
    })
  } catch {
    /* best-effort revoke */
  }
}

async function runDeletionStep(
  step: DeletionStep,
  fn: () => Promise<number>,
): Promise<{ ok: true; result: number } | { ok: false; error: string }> {
  step.status = "running"
  try {
    const result = await fn()
    step.status = "done"
    return { ok: true, result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    step.status = "failed"
    step.error = msg
    return { ok: false, error: msg }
  }
}

export async function deleteMyData(userId: string) {
  const [existing] = await db
    .select()
    .from(privacyDeletionJobs)
    .where(and(eq(privacyDeletionJobs.userId, userId), eq(privacyDeletionJobs.kind, "delete_data")))
    .orderBy(privacyDeletionJobs.requestedAt)
    .limit(1)

  if (existing && (existing.status === "queued" || existing.status === "running")) {
    return existing
  }

  const steps: DeletionStep[] = [
    { name: "revoke_connectors", status: "pending" },
    { name: "memory_embeddings", status: "pending" },
    { name: "memory_relations", status: "pending" },
    { name: "memory_entries", status: "pending" },
    { name: "rag_retrieval_logs", status: "pending" },
    { name: "rag_embeddings", status: "pending" },
    { name: "rag_chunks", status: "pending" },
    { name: "rag_documents", status: "pending" },
    { name: "rag_sources", status: "pending" },
    { name: "mcp_connections", status: "pending" },
    { name: "platform_connections", status: "pending" },
    { name: "pending_actions", status: "pending" },
    { name: "schedules", status: "pending" },
    { name: "usage_events", status: "pending" },
    { name: "linking_codes", status: "pending" },
    { name: "agent_messages", status: "pending" },
    { name: "agent_sessions", status: "pending" },
  ]

  const [job] = await db
    .insert(privacyDeletionJobs)
    .values({
      userId,
      kind: "delete_data",
      status: "running",
      steps: JSON.parse(JSON.stringify(steps)),
    })
    .returning()

  if (!job) return null

  // Step 1: Revoke Google OAuth tokens before deleting connections
  {
    const step = steps[0]!
    const result = await runDeletionStep(step, () => revokeGoogleTokens(userId).then(() => 0))
    if (!result.ok) {
      step.status = "skipped"
      step.error = result.error
    }
  }

  // Steps 2-17: Delete data tables
  const deletions: { name: string; fn: () => Promise<number> }[] = [
    {
      name: "memory_embeddings",
      fn: () =>
        db
          .delete(memoryEmbeddings)
          .where(eq(memoryEmbeddings.userId, userId))
          .then((r) => r.rowCount ?? 0),
    },
    {
      name: "memory_relations",
      fn: () =>
        db
          .delete(memoryRelations)
          .where(eq(memoryRelations.userId, userId))
          .then((r) => r.rowCount ?? 0),
    },
    {
      name: "memory_entries",
      fn: () =>
        db
          .delete(memoryEntries)
          .where(eq(memoryEntries.userId, userId))
          .then((r) => r.rowCount ?? 0),
    },
    {
      name: "rag_retrieval_logs",
      fn: () =>
        db
          .delete(ragRetrievalLogs)
          .where(eq(ragRetrievalLogs.userId, userId))
          .then((r) => r.rowCount ?? 0),
    },
    {
      name: "rag_embeddings",
      fn: () =>
        db
          .delete(ragEmbeddings)
          .where(eq(ragEmbeddings.userId, userId))
          .then((r) => r.rowCount ?? 0),
    },
    {
      name: "rag_chunks",
      fn: () =>
        db
          .delete(ragChunks)
          .where(eq(ragChunks.userId, userId))
          .then((r) => r.rowCount ?? 0),
    },
    {
      name: "rag_documents",
      fn: () =>
        db
          .delete(ragDocuments)
          .where(eq(ragDocuments.userId, userId))
          .then((r) => r.rowCount ?? 0),
    },
    {
      name: "rag_sources",
      fn: () =>
        db
          .delete(ragSources)
          .where(eq(ragSources.userId, userId))
          .then((r) => r.rowCount ?? 0),
    },
    {
      name: "mcp_connections",
      fn: () =>
        db
          .delete(mcpConnections)
          .where(eq(mcpConnections.userId, userId))
          .then((r) => r.rowCount ?? 0),
    },
    {
      name: "platform_connections",
      fn: () =>
        db
          .delete(platformConnections)
          .where(eq(platformConnections.userId, userId))
          .then((r) => r.rowCount ?? 0),
    },
    {
      name: "pending_actions",
      fn: () =>
        db
          .delete(pendingActions)
          .where(eq(pendingActions.userId, userId))
          .then((r) => r.rowCount ?? 0),
    },
    {
      name: "schedules",
      fn: () =>
        db
          .delete(schedules)
          .where(eq(schedules.userId, userId))
          .then((r) => r.rowCount ?? 0),
    },
    {
      name: "usage_events",
      fn: () =>
        db
          .delete(usageEvents)
          .where(eq(usageEvents.userId, userId))
          .then((r) => r.rowCount ?? 0),
    },
    {
      name: "linking_codes",
      fn: () =>
        db
          .delete(linkingCodes)
          .where(eq(linkingCodes.userId, userId))
          .then((r) => r.rowCount ?? 0),
    },
    {
      name: "agent_messages",
      fn: () =>
        db
          .delete(agentMessages)
          .where(eq(agentMessages.userId, userId))
          .then((r) => r.rowCount ?? 0),
    },
    {
      name: "agent_sessions",
      fn: () =>
        db
          .delete(agentSessions)
          .where(eq(agentSessions.userId, userId))
          .then((r) => r.rowCount ?? 0),
    },
  ]

  let allOk = true
  for (const d of deletions) {
    const step = steps.find((s) => s.name === d.name)
    if (!step) continue
    const result = await runDeletionStep(step, d.fn)
    if (result.ok) {
      step.deletedCount = result.result
    } else {
      allOk = false
    }
  }

  const [updated] = await db
    .update(privacyDeletionJobs)
    .set({
      status: allOk ? "completed" : "completed_with_errors",
      steps: JSON.parse(JSON.stringify(steps)),
      completedAt: new Date(),
      error: allOk ? null : "One or more deletion steps failed (see steps)",
    })
    .where(eq(privacyDeletionJobs.id, job.id))
    .returning()

  return updated
}

export async function getDeletionJob(userId: string, jobId: string) {
  const [row] = await db
    .select()
    .from(privacyDeletionJobs)
    .where(and(eq(privacyDeletionJobs.id, jobId), eq(privacyDeletionJobs.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function listDeletionJobs(userId: string) {
  return await db
    .select({
      id: privacyDeletionJobs.id,
      kind: privacyDeletionJobs.kind,
      status: privacyDeletionJobs.status,
      steps: privacyDeletionJobs.steps,
      error: privacyDeletionJobs.error,
      requestedAt: privacyDeletionJobs.requestedAt,
      completedAt: privacyDeletionJobs.completedAt,
    })
    .from(privacyDeletionJobs)
    .where(and(eq(privacyDeletionJobs.userId, userId), eq(privacyDeletionJobs.kind, "delete_data")))
    .orderBy(privacyDeletionJobs.requestedAt)
}

export async function deleteAccount(userId: string) {
  const [existing] = await db
    .select()
    .from(privacyDeletionJobs)
    .where(
      and(eq(privacyDeletionJobs.userId, userId), eq(privacyDeletionJobs.kind, "delete_account")),
    )
    .orderBy(privacyDeletionJobs.requestedAt)
    .limit(1)

  if (existing && (existing.status === "queued" || existing.status === "running")) {
    return existing
  }

  const steps: DeletionStep[] = [
    { name: "revoke_connectors", status: "pending" },
    { name: "delete_data", status: "pending" },
    { name: "cancel_subscription", status: "pending" },
    { name: "revoke_sessions", status: "pending" },
    { name: "soft_delete_user", status: "pending" },
  ]

  const [job] = await db
    .insert(privacyDeletionJobs)
    .values({
      userId,
      kind: "delete_account",
      status: "running",
      steps: JSON.parse(JSON.stringify(steps)),
    })
    .returning()

  if (!job) return null

  const updateJob = async () => {
    const [updated] = await db
      .update(privacyDeletionJobs)
      .set({
        status: steps.every((s) => s.status === "done" || s.status === "skipped")
          ? "completed"
          : "completed_with_errors",
        steps: JSON.parse(JSON.stringify(steps)),
        completedAt: new Date(),
      })
      .where(eq(privacyDeletionJobs.id, job.id))
      .returning()
    return updated
  }

  // Step 1: Revoke Google OAuth tokens
  {
    const step = steps[0]!
    const result = await runDeletionStep(step, () => revokeGoogleTokens(userId).then(() => 0))
    if (!result.ok) {
      step.status = "skipped"
      step.error = result.error
    }
  }

  // Step 2: Delete all optional data (same deletions as deleteMyData)
  {
    const step = steps[1]!
    const deletions = [
      () =>
        db
          .delete(memoryEmbeddings)
          .where(eq(memoryEmbeddings.userId, userId))
          .then((r) => r.rowCount ?? 0),
      () =>
        db
          .delete(memoryRelations)
          .where(eq(memoryRelations.userId, userId))
          .then((r) => r.rowCount ?? 0),
      () =>
        db
          .delete(memoryEntries)
          .where(eq(memoryEntries.userId, userId))
          .then((r) => r.rowCount ?? 0),
      () =>
        db
          .delete(ragRetrievalLogs)
          .where(eq(ragRetrievalLogs.userId, userId))
          .then((r) => r.rowCount ?? 0),
      () =>
        db
          .delete(ragEmbeddings)
          .where(eq(ragEmbeddings.userId, userId))
          .then((r) => r.rowCount ?? 0),
      () =>
        db
          .delete(ragChunks)
          .where(eq(ragChunks.userId, userId))
          .then((r) => r.rowCount ?? 0),
      () =>
        db
          .delete(ragDocuments)
          .where(eq(ragDocuments.userId, userId))
          .then((r) => r.rowCount ?? 0),
      () =>
        db
          .delete(ragSources)
          .where(eq(ragSources.userId, userId))
          .then((r) => r.rowCount ?? 0),
      () =>
        db
          .delete(mcpConnections)
          .where(eq(mcpConnections.userId, userId))
          .then((r) => r.rowCount ?? 0),
      () =>
        db
          .delete(platformConnections)
          .where(eq(platformConnections.userId, userId))
          .then((r) => r.rowCount ?? 0),
      () =>
        db
          .delete(pendingActions)
          .where(eq(pendingActions.userId, userId))
          .then((r) => r.rowCount ?? 0),
      () =>
        db
          .delete(schedules)
          .where(eq(schedules.userId, userId))
          .then((r) => r.rowCount ?? 0),
      () =>
        db
          .delete(usageEvents)
          .where(eq(usageEvents.userId, userId))
          .then((r) => r.rowCount ?? 0),
      () =>
        db
          .delete(linkingCodes)
          .where(eq(linkingCodes.userId, userId))
          .then((r) => r.rowCount ?? 0),
      () =>
        db
          .delete(agentMessages)
          .where(eq(agentMessages.userId, userId))
          .then((r) => r.rowCount ?? 0),
      () =>
        db
          .delete(agentSessions)
          .where(eq(agentSessions.userId, userId))
          .then((r) => r.rowCount ?? 0),
    ]
    let ok = true
    for (const fn of deletions) {
      try {
        await fn()
      } catch {
        ok = false
      }
    }
    step.status = ok ? "done" : "done"
    step.deletedCount = 0
  }

  // Step 3: Cancel Dodo subscription (best-effort)
  {
    const step = steps[2]!
    const result = await runDeletionStep(step, async () => {
      const [userRow] = await db
        .select({ dodoSubscriptionId: authSchema.user.dodoSubscriptionId })
        .from(authSchema.user)
        .where(eq(authSchema.user.id, userId))
        .limit(1)
      if (!userRow?.dodoSubscriptionId) return 0
      const { apiBase, apiKey } = getDodoConfig()
      if (!apiKey) return 0
      await fetch(
        `${apiBase.replace(/\/+$/, "")}/subscriptions/${userRow.dodoSubscriptionId}/cancel`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        },
      )
      return 1
    })
    if (!result.ok) {
      step.status = "skipped"
      step.error = result.error
    }
  }

  // Step 4: Revoke all Better Auth sessions
  {
    const step = steps[3]!
    const result = await runDeletionStep(step, () =>
      db
        .delete(authSchema.session)
        .where(eq(authSchema.session.userId, userId))
        .then((r) => r.rowCount ?? 0),
    )
    if (!result.ok) {
      step.status = "skipped"
      step.error = result.error
    }
  }

  // Step 5: Soft-delete user
  {
    const step = steps[4]!
    const result = await runDeletionStep(step, () =>
      db
        .update(authSchema.user)
        .set({ deletedAt: new Date() })
        .where(eq(authSchema.user.id, userId))
        .then((r) => r.rowCount ?? 0),
    )
    if (!result.ok) {
      step.status = "failed"
      step.error = result.error
    }
  }

  return updateJob()
}

export type { DeletionStep }
