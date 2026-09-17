import { eq } from "drizzle-orm"
import { db, privacyPreferences } from "@yomi/db"

export type PrivacyPreferencesShape = {
  conversationHistoryEnabled: boolean
  memoryEnabled: boolean
  cloudMemoryEnabled: boolean
  connectorsEnabled: boolean
  analyticsEnabled: boolean
  voiceProcessingEnabled: boolean
  aiImprovementEnabled: boolean
  telegramProcessingEnabled: boolean
  retentionOverrides: Record<string, unknown> | null
  updatedAt: Date
}

export type PrivacyPreferencePatch = Partial<Omit<PrivacyPreferencesShape, "updatedAt">>

// The consent store is read repeatedly inside a single Telegram turn — once for
// conversation_history in the gateway and again for memory + cloud_memory in the
// agent loop — and every check re-reads both the preferences row and the full
// consent history. On a Worker each of those reads is a billed subrequest against
// a hard per-invocation cap, so the same two rows were fetched up to eight times
// per turn. Memoise them briefly and drop the entry on any write, so a decision
// made in this process is never masked. The short TTL only bounds staleness from
// a write made in another isolate.
const READ_CACHE_TTL_MS = 2_000
const readCache = new Map<string, { at: number; value: Promise<unknown> }>()

export function memoPrivacyRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = readCache.get(key)
  if (hit && Date.now() - hit.at < READ_CACHE_TTL_MS) return hit.value as Promise<T>

  const value = load().catch((err) => {
    readCache.delete(key)
    throw err
  })
  readCache.set(key, { at: Date.now(), value })
  return value
}

export function invalidatePrivacyReadCache(userId: string): void {
  readCache.delete(`prefs:${userId}`)
  readCache.delete(`consents:${userId}`)
}

const DEFAULT_PREFERENCES: PrivacyPreferencesShape = {
  conversationHistoryEnabled: false,
  memoryEnabled: false,
  cloudMemoryEnabled: false,
  connectorsEnabled: false,
  analyticsEnabled: false,
  voiceProcessingEnabled: false,
  aiImprovementEnabled: false,
  telegramProcessingEnabled: false,
  retentionOverrides: null,
  updatedAt: new Date(0),
}

function serialize(row: typeof privacyPreferences.$inferSelect): PrivacyPreferencesShape {
  return {
    conversationHistoryEnabled: row.conversationHistoryEnabled,
    memoryEnabled: row.memoryEnabled,
    cloudMemoryEnabled: row.cloudMemoryEnabled,
    connectorsEnabled: row.connectorsEnabled,
    analyticsEnabled: row.analyticsEnabled,
    voiceProcessingEnabled: row.voiceProcessingEnabled,
    aiImprovementEnabled: row.aiImprovementEnabled,
    telegramProcessingEnabled: row.telegramProcessingEnabled,
    retentionOverrides: row.retentionOverrides as Record<string, unknown> | null,
    updatedAt: row.updatedAt,
  }
}

export async function getPrivacyPreferences(userId: string): Promise<PrivacyPreferencesShape> {
  return memoPrivacyRead(`prefs:${userId}`, async () => {
    const [row] = await db
      .select()
      .from(privacyPreferences)
      .where(eq(privacyPreferences.userId, userId))
      .limit(1)
    return row ? serialize(row) : DEFAULT_PREFERENCES
  })
}

export async function updatePrivacyPreferences(
  userId: string,
  patch: PrivacyPreferencePatch,
): Promise<PrivacyPreferencesShape> {
  invalidatePrivacyReadCache(userId)
  const values = { ...patch, userId, updatedAt: new Date() }
  const [row] = await db
    .insert(privacyPreferences)
    .values(values)
    .onConflictDoUpdate({
      target: privacyPreferences.userId,
      set: { ...patch, updatedAt: values.updatedAt },
    })
    .returning()
  return row ? serialize(row) : await getPrivacyPreferences(userId)
}
