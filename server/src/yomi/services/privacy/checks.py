"""Consent + preference checks.

Port of apps/backend/src/services/privacy/checks.ts.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from yomi.shared.privacy import PRIVACY_CONSENT_PURPOSES

from .consent import ConsentContext, get_consent_snapshot, record_consent_decision
from .preferences import get_privacy_preferences

PURPOSE_TO_PREFERENCE_KEY = {
    "conversation_history": "conversation_history_enabled",
    "memory": "memory_enabled",
    "cloud_memory": "cloud_memory_enabled",
    "connector_data": "connectors_enabled",
    "analytics": "analytics_enabled",
    "voice_processing": "voice_processing_enabled",
    "ai_improvement": "ai_improvement_enabled",
    "telegram_processing": "telegram_processing_enabled",
}


@dataclass
class ConsentCheckResult:
    allowed: bool
    reason: str | None
    # Whether the user has ever made an explicit decision (grant or revoke) for
    # this purpose. False means "never asked" — callers may auto-grant where the
    # surrounding action already implies consent (e.g. linking Telegram).
    decided: bool


async def check_consent(
    session: AsyncSession, user_id: str, purpose: str
) -> ConsentCheckResult:
    if purpose not in PRIVACY_CONSENT_PURPOSES:
        return ConsentCheckResult(
            allowed=False, reason=f"{purpose} is not a valid purpose", decided=True
        )

    preferences = await get_privacy_preferences(session, user_id)
    consents = await get_consent_snapshot(session, user_id)

    consent = next((c for c in consents if c.purpose == purpose), None)
    decided = consent is not None

    pref_key = PURPOSE_TO_PREFERENCE_KEY.get(purpose)
    if pref_key and not getattr(preferences, pref_key):
        return ConsentCheckResult(
            allowed=False, reason=f"{purpose} preference is disabled", decided=decided
        )

    if consent is None or consent.status != "granted":
        return ConsentCheckResult(
            allowed=False, reason=f"{purpose} consent has not been granted", decided=decided
        )

    return ConsentCheckResult(allowed=True, reason=None, decided=decided)


# Contextual consent: grant purposes the user has never explicitly decided,
# tied to a clear user action that already implies them (completing a connector
# OAuth flow, linking Telegram). Explicit revocations are never overridden —
# only truly undecided purposes are granted.
async def grant_consent_if_undecided(
    session: AsyncSession,
    user_id: str,
    purposes: list[str],
    source: str,
) -> None:
    undecided: list[str] = []
    for purpose in purposes:
        result = await check_consent(session, user_id, purpose)
        if not result.decided:
            undecided.append(purpose)
    if not undecided:
        return
    await record_consent_decision(
        session,
        user_id=user_id,
        purposes=undecided,
        status="granted",
        context=ConsentContext(metadata={"source": source}),
    )