export const PRIVACY_POLICY_VERSION = "2026-07-18"
export const TERMS_VERSION = "2026-07-04"
export const CONSENT_VERSION = "2026-07-04"

export const PRIVACY_CONSENT_PURPOSES = [
  "conversation_history",
  "memory",
  "cloud_memory",
  "connector_data",
  "analytics",
  "voice_processing",
  "ai_improvement",
  "telegram_processing",
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
  ai_improvement: "AI improvement",
  telegram_processing: "Telegram processing",
}

export function isPrivacyConsentPurpose(value: string): value is PrivacyConsentPurpose {
  return (PRIVACY_CONSENT_PURPOSES as readonly string[]).includes(value)
}

// Plain-language explanation of what each purpose actually turns on, shown in
// the dashboard's Privacy & Consent list so a toggle isn't just a bare label.
export const PRIVACY_CONSENT_PURPOSE_DESCRIPTIONS: Record<PrivacyConsentPurpose, string> = {
  conversation_history:
    "Stores your Telegram conversation history so Yomi has context across messages, and so you can review past chats in the dashboard.",
  memory:
    "Lets Yomi extract and remember durable facts about you — preferences, ongoing projects, decisions — so it doesn't need reminding every time.",
  cloud_memory:
    "Lets Yomi search and quote from your synced Google Drive files and uploaded documents.",
  connector_data:
    "Lets Yomi read and act on data from apps you connect — Gmail, Calendar, Slack, Notion, GitHub, and more.",
  analytics:
    "Lets Yomi collect product usage analytics (which features get used, how often) to guide what gets improved.",
  voice_processing: "Lets Yomi transcribe and respond to voice messages you send on Telegram.",
  ai_improvement: "Lets Yomi use your conversations to help improve its underlying AI models.",
  telegram_processing:
    "Lets Yomi process the messages you send on Telegram — required for the bot to work at all.",
}

// Every purpose is on by default: granted at signup, and a purpose the user has
// never decided counts as on. Users switch any of them off on the privacy page,
// and an explicit revoke always wins.
export const SIGNUP_DEFAULT_CONSENT_PURPOSES: readonly PrivacyConsentPurpose[] =
  PRIVACY_CONSENT_PURPOSES

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
  expired_codes: { label: "Expired link codes", days: 0, userOverridable: false },
}

export function isRetentionDomainKey(value: string): value is RetentionDomainKey {
  return Object.prototype.hasOwnProperty.call(RETENTION_DEFAULTS, value)
}
