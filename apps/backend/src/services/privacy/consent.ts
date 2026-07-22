import { desc, eq } from "drizzle-orm"
import {
  CONSENT_VERSION,
  PRIVACY_POLICY_VERSION,
  TERMS_VERSION,
  type PrivacyConsentPurpose,
  type PrivacyConsentStatus,
} from "@yomi/shared/privacy"
import { db, privacyConsents } from "@yomi/db"
import * as authSchema from "../../auth-schema.js"
import { updatePrivacyPreferences, type PrivacyPreferencePatch } from "./preferences.js"

type BooleanPreferenceKey = Exclude<keyof PrivacyPreferencePatch, "retentionOverrides">

type ConsentContext = {
  ipAddress?: string | null
  userAgent?: string | null
  appVersion?: string | null
  metadata?: Record<string, string | number | boolean | null | string[]>
}

const PURPOSE_TO_PREFERENCE: Partial<Record<PrivacyConsentPurpose, BooleanPreferenceKey>> = {
  conversation_history: "conversationHistoryEnabled",
  memory: "memoryEnabled",
  cloud_memory: "cloudMemoryEnabled",
  connector_data: "connectorsEnabled",
  analytics: "analyticsEnabled",
  voice_processing: "voiceProcessingEnabled",
  ai_improvement: "aiImprovementEnabled",
  telegram_processing: "telegramProcessingEnabled",
}

export type ConsentSnapshot = {
  purpose: PrivacyConsentPurpose
  status: PrivacyConsentStatus
  consentVersion: string
  privacyPolicyVersion: string
  termsVersion: string
  appVersion: string | null
  createdAt: Date
}

export async function listConsentHistory(userId: string) {
  return await db
    .select({
      id: privacyConsents.id,
      purpose: privacyConsents.purpose,
      status: privacyConsents.status,
      consentVersion: privacyConsents.consentVersion,
      privacyPolicyVersion: privacyConsents.privacyPolicyVersion,
      termsVersion: privacyConsents.termsVersion,
      appVersion: privacyConsents.appVersion,
      createdAt: privacyConsents.createdAt,
    })
    .from(privacyConsents)
    .where(eq(privacyConsents.userId, userId))
    .orderBy(desc(privacyConsents.createdAt))
}

export async function getConsentSnapshot(userId: string): Promise<ConsentSnapshot[]> {
  const rows = await listConsentHistory(userId)
  const latest = new Map<PrivacyConsentPurpose, ConsentSnapshot>()
  for (const row of rows) {
    const purpose = row.purpose as PrivacyConsentPurpose
    if (latest.has(purpose)) continue
    latest.set(purpose, {
      purpose,
      status: row.status as PrivacyConsentStatus,
      consentVersion: row.consentVersion,
      privacyPolicyVersion: row.privacyPolicyVersion,
      termsVersion: row.termsVersion,
      appVersion: row.appVersion,
      createdAt: row.createdAt,
    })
  }
  return Array.from(latest.values())
}

export async function recordConsentDecision(input: {
  userId: string
  purposes: PrivacyConsentPurpose[]
  status: PrivacyConsentStatus
  context: ConsentContext
}): Promise<ConsentSnapshot[]> {
  if (!input.purposes.length) return await getConsentSnapshot(input.userId)

  await db.insert(privacyConsents).values(
    input.purposes.map((purpose) => ({
      userId: input.userId,
      purpose,
      status: input.status,
      consentVersion: CONSENT_VERSION,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      termsVersion: TERMS_VERSION,
      appVersion: input.context.appVersion ?? null,
      ipAddress: input.context.ipAddress ?? null,
      userAgent: input.context.userAgent ?? null,
      metadata: input.context.metadata ?? null,
    })),
  )

  const preferencePatch: PrivacyPreferencePatch = {}
  for (const purpose of input.purposes) {
    const key = PURPOSE_TO_PREFERENCE[purpose]
    if (key) preferencePatch[key] = input.status === "granted"
  }
  if (Object.keys(preferencePatch).length) {
    await updatePrivacyPreferences(input.userId, preferencePatch)
  }

  if (input.status === "granted") {
    await db
      .update(authSchema.user)
      .set({
        consentVersion: CONSENT_VERSION,
        consentTimestamp: new Date(),
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
        termsVersion: TERMS_VERSION,
      })
      .where(eq(authSchema.user.id, input.userId))
  }

  return await getConsentSnapshot(input.userId)
}
