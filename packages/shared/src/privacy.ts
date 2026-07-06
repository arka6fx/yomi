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

// Default retention windows (spec 23 §13.1). days: null = keep until user
// deletes. userOverridable domains may be tightened (never extended) via
// privacy_preferences.retention_overrides = { [domain]: days }.
export type RetentionDomainKey =
  | "conversations"
  | "rag_retrieval_logs"
  | "usage_events"
  | "pending_actions"
  | "devices"
  | "expired_codes"

export type RetentionPolicy = {
  label: string
  days: number
  userOverridable: boolean
}

export const RETENTION_DEFAULTS: Record<RetentionDomainKey, RetentionPolicy> = {
  conversations: { label: "Conversation history", days: 180, userOverridable: true },
  rag_retrieval_logs: { label: "Search activity logs", days: 30, userOverridable: false },
  usage_events: { label: "Detailed usage events", days: 90, userOverridable: false },
  pending_actions: { label: "Pending action requests", days: 7, userOverridable: false },
  devices: { label: "Inactive device records", days: 180, userOverridable: false },
  expired_codes: { label: "Expired link/device codes", days: 0, userOverridable: false },
}

export function isRetentionDomainKey(value: string): value is RetentionDomainKey {
  return Object.prototype.hasOwnProperty.call(RETENTION_DEFAULTS, value)
}
