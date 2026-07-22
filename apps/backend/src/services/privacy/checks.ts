import { type PrivacyConsentPurpose } from "@yomi/shared/privacy"
import { getConsentSnapshot, recordConsentDecision } from "./consent.js"
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
  ai_improvement: "aiImprovementEnabled",
  telegram_processing: "telegramProcessingEnabled",
}

export type ConsentCheckResult = {
  allowed: boolean
  reason: string | null
  // Whether the user has ever made an explicit decision (grant or revoke) for
  // this purpose. False means "never asked" — callers may auto-grant where the
  // surrounding action already implies consent (e.g. linking Telegram).
  decided: boolean
}

export async function checkConsent(
  userId: string,
  purpose: PrivacyConsentPurpose,
): Promise<ConsentCheckResult> {
  const [preferences, consents] = await Promise.all([
    getPrivacyPreferences(userId),
    getConsentSnapshot(userId),
  ])

  const consent = consents.find((c) => c.purpose === purpose)
  const decided = consent !== undefined

  const prefKey = PURPOSE_TO_PREFERENCE_KEY[purpose]
  if (prefKey && !preferences[prefKey]) {
    return { allowed: false, reason: `${purpose} preference is disabled`, decided }
  }

  if (!consent || consent.status !== "granted") {
    return { allowed: false, reason: `${purpose} consent has not been granted`, decided }
  }

  return { allowed: true, reason: null, decided }
}

// Contextual consent: grant purposes the user has never explicitly decided,
// tied to a clear user action that already implies them (completing a
// connector OAuth flow, linking Telegram). Explicit revocations are never
// overridden — only truly undecided purposes are granted.
export async function grantConsentIfUndecided(
  userId: string,
  purposes: PrivacyConsentPurpose[],
  source: string,
): Promise<void> {
  const undecided: PrivacyConsentPurpose[] = []
  for (const purpose of purposes) {
    const result = await checkConsent(userId, purpose)
    if (!result.decided) undecided.push(purpose)
  }
  if (undecided.length === 0) return
  await recordConsentDecision({
    userId,
    purposes: undecided,
    status: "granted",
    context: {
      appVersion: null,
      ipAddress: null,
      userAgent: null,
      metadata: { source },
    },
  })
}
