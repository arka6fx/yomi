export const PRIVACY_POLICY_VERSION = "2026-07-04"
export const TERMS_VERSION = "2026-07-04"
export const CONSENT_VERSION = "2026-07-04"

export const PRIVACY_CONSENT_PURPOSES = [
  "conversation_history",
  "memory",
  "cloud_memory",
  "connector_data",
  "analytics",
  "voice_processing",
  "screen_processing",
  "ai_improvement",
  "telegram_processing",
  "rag_processing",
] as const

export type PrivacyConsentPurpose = (typeof PRIVACY_CONSENT_PURPOSES)[number]
export type PrivacyConsentStatus = "granted" | "revoked"

export const PRIVACY_CONSENT_PURPOSE_LABELS: Record<PrivacyConsentPurpose, string> = {
  conversation_history: "Conversation history",
  memory: "Memory",
  cloud_memory: "Cloud memory",
  connector_data: "Connector data",
  analytics: "Analytics",
  voice_processing: "Voice processing",
  screen_processing: "Screen processing",
  ai_improvement: "AI improvement",
  telegram_processing: "Telegram processing",
  rag_processing: "Document search",
}

export function isPrivacyConsentPurpose(value: string): value is PrivacyConsentPurpose {
  return (PRIVACY_CONSENT_PURPOSES as readonly string[]).includes(value)
}
