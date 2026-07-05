import type { Context } from "hono"
import { desc, eq } from "drizzle-orm"
import { db, privacyAuditEvents } from "@yomi/db"

type AuditMetadata = Record<string, string | number | boolean | null | string[]>

const BLOCKED_METADATA_KEYS = [
  "accessToken",
  "refreshToken",
  "idToken",
  "token",
  "apiKey",
  "password",
  "secret",
  "prompt",
  "content",
  "conversation",
  "screenshot",
  "attachment",
  "email",
]

export function clientIp(c: Context): string | null {
  return (
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    null
  )
}

export function userAgent(c: Context): string | null {
  return c.req.header("User-Agent") ?? null
}

function isSafeMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return !BLOCKED_METADATA_KEYS.some((blocked) => normalized.includes(blocked.toLowerCase()))
}

export function sanitizeAuditMetadata(metadata: AuditMetadata | undefined): AuditMetadata | null {
  if (!metadata) return null
  const safe: AuditMetadata = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (!isSafeMetadataKey(key)) continue
    safe[key] = value
  }
  return Object.keys(safe).length ? safe : null
}

export async function recordPrivacyAuditEvent(input: {
  actorUserId?: string | null
  targetUserId?: string | null
  eventType: string
  resourceType?: string | null
  resourceId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  metadata?: AuditMetadata
}): Promise<void> {
  await db.insert(privacyAuditEvents).values({
    actorUserId: input.actorUserId ?? null,
    targetUserId: input.targetUserId ?? input.actorUserId ?? null,
    eventType: input.eventType,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    metadata: sanitizeAuditMetadata(input.metadata),
  })
}

export async function listPrivacyActivity(userId: string, limit: number) {
  return await db
    .select({
      id: privacyAuditEvents.id,
      eventType: privacyAuditEvents.eventType,
      resourceType: privacyAuditEvents.resourceType,
      resourceId: privacyAuditEvents.resourceId,
      metadata: privacyAuditEvents.metadata,
      createdAt: privacyAuditEvents.createdAt,
    })
    .from(privacyAuditEvents)
    .where(eq(privacyAuditEvents.targetUserId, userId))
    .orderBy(desc(privacyAuditEvents.createdAt))
    .limit(limit)
}
