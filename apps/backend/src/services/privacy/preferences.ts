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
  const [row] = await db
    .select()
    .from(privacyPreferences)
    .where(eq(privacyPreferences.userId, userId))
    .limit(1)
  return row ? serialize(row) : DEFAULT_PREFERENCES
}

export async function updatePrivacyPreferences(
  userId: string,
  patch: PrivacyPreferencePatch,
): Promise<PrivacyPreferencesShape> {
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
