import { type PrivacyConsentPurpose } from "@yomi/shared/privacy"
import { getConsentSnapshot } from "./consent.js"
import { getPrivacyPreferences, type PrivacyPreferencesShape } from "./preferences.js"

type BooleanPrefKey = {
  [K in keyof PrivacyPreferencesShape]: PrivacyPreferencesShape[K] extends boolean ? K : never
}[keyof PrivacyPreferencesShape]

const PURPOSE_TO_PREFERENCE_KEY: Partial<Record<PrivacyConsentPurpose, BooleanPrefKey>> = {
  conversation_history: "conversationHistoryEnabled",
  memory: "memoryEnabled",
  cloud_memory: "cloudMemoryEnabled",
  connector_data: "connectorsEnabled",
  analytics: "analyticsEnabled",
  voice_processing: "voiceProcessingEnabled",
  screen_processing: "screenProcessingEnabled",
  ai_improvement: "aiImprovementEnabled",
}

export type ConsentCheckResult = {
  allowed: boolean
  reason: string | null
}

export async function checkConsent(userId: string, purpose: PrivacyConsentPurpose): Promise<ConsentCheckResult> {
  const [preferences, consents] = await Promise.all([
    getPrivacyPreferences(userId),
    getConsentSnapshot(userId),
  ])

  const prefKey = PURPOSE_TO_PREFERENCE_KEY[purpose]
  if (prefKey && !preferences[prefKey]) {
    return { allowed: false, reason: `${purpose} preference is disabled` }
  }

  const consent = consents.find((c) => c.purpose === purpose)
  if (!consent || consent.status !== "granted") {
    return { allowed: false, reason: `${purpose} consent has not been granted` }
  }

  return { allowed: true, reason: null }
}
