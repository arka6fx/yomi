"""Privacy constants: consent purposes, versions, retention defaults.

Port of packages/shared/src/privacy.ts.
"""

from __future__ import annotations

PRIVACY_POLICY_VERSION = "2026-07-18"
TERMS_VERSION = "2026-07-04"
CONSENT_VERSION = "2026-07-04"

PRIVACY_CONSENT_PURPOSES = (
    "conversation_history",
    "memory",
    "cloud_memory",
    "connector_data",
    "analytics",
    "voice_processing",
    "ai_improvement",
    "telegram_processing",
)

PRIVACY_CONSENT_PURPOSE_LABELS: dict[str, str] = {
    "conversation_history": "Conversation history",
    "memory": "Memory",
    "cloud_memory": "Cloud memory",
    "connector_data": "Connector data",
    "analytics": "Analytics",
    "voice_processing": "Voice processing",
    "ai_improvement": "AI improvement",
    "telegram_processing": "Telegram processing",
}

PRIVACY_CONSENT_PURPOSE_DESCRIPTIONS: dict[str, str] = {
    "conversation_history": (
        "Stores your Telegram conversation history so Yomi has context across messages, "
        "and so you can review past chats in the dashboard."
    ),
    "memory": (
        "Lets Yomi extract and remember durable facts about you — preferences, ongoing "
        "projects, decisions — so it doesn't need reminding every time."
    ),
    "cloud_memory": (
        "Lets Yomi search and quote from your synced Google Drive files and uploaded "
        "documents."
    ),
    "connector_data": (
        "Lets Yomi read and act on data from apps you connect — Gmail, Calendar, Slack, "
        "Notion, GitHub, and more."
    ),
    "analytics": (
        "Lets Yomi collect product usage analytics (which features get used, how often) "
        "to guide what gets improved."
    ),
    "voice_processing": "Lets Yomi transcribe and respond to voice messages you send on Telegram.",
    "ai_improvement": "Lets Yomi use your conversations to help improve its underlying AI models.",
    "telegram_processing": (
        "Lets Yomi process the messages you send on Telegram — required for the bot to "
        "work at all."
    ),
}

# Granted automatically at signup so the product works out of the box.
SIGNUP_DEFAULT_CONSENT_PURPOSES = (
    "conversation_history",
    "memory",
    "connector_data",
    "telegram_processing",
)

OPT_IN_CONSENT_PURPOSES = tuple(
    p for p in PRIVACY_CONSENT_PURPOSES if p not in SIGNUP_DEFAULT_CONSENT_PURPOSES
)


def is_privacy_consent_purpose(value: str) -> bool:
    return value in PRIVACY_CONSENT_PURPOSES


# Default retention windows (spec 23 §13.1). days: null = keep until user deletes.
RETENTION_DEFAULTS: dict[str, dict[str, object]] = {
    "conversations": {"label": "Conversation history", "days": 180, "userOverridable": True},
    "rag_retrieval_logs": {"label": "Search activity logs", "days": 30, "userOverridable": False},
    "usage_events": {"label": "Detailed usage events", "days": 90, "userOverridable": False},
    "pending_actions": {"label": "Pending action requests", "days": 7, "userOverridable": False},
    "devices": {"label": "Inactive device records", "days": 180, "userOverridable": False},
    "expired_codes": {"label": "Expired link codes", "days": 0, "userOverridable": False},
}


def is_retention_domain_key(value: str) -> bool:
    return value in RETENTION_DEFAULTS