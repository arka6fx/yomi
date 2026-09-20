"""Consent history + decision recording.

Port of apps/backend/src/services/privacy/consent.ts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.db.models_app2 import PrivacyConsent
from yomi.db.models_auth import User
from yomi.shared.privacy import CONSENT_VERSION, PRIVACY_POLICY_VERSION, TERMS_VERSION

from .preferences import (
    invalidate_privacy_read_cache,
    memo_privacy_read,
    update_privacy_preferences,
)

# Maps each purpose to the preference boolean toggled by its decision.
PURPOSE_TO_PREFERENCE = {
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
class ConsentSnapshot:
    purpose: str
    status: str
    consent_version: str
    privacy_policy_version: str
    terms_version: str
    app_version: str | None
    created_at: datetime


@dataclass
class ConsentContext:
    ip_address: str | None = None
    user_agent: str | None = None
    app_version: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


async def list_consent_history(session: AsyncSession, user_id: str) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(PrivacyConsent)
            .where(PrivacyConsent.user_id == user_id)
            .order_by(desc(PrivacyConsent.created_at))
        )
    ).scalars()
    return [_consent_dict(r) for r in rows]


def _consent_dict(row: PrivacyConsent) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "purpose": row.purpose,
        "status": row.status,
        "consentVersion": row.consent_version,
        "privacyPolicyVersion": row.privacy_policy_version,
        "termsVersion": row.terms_version,
        "appVersion": row.app_version,
        "createdAt": row.created_at,
    }


def snapshot_to_dict(snap: ConsentSnapshot) -> dict[str, Any]:
    return {
        "purpose": snap.purpose,
        "status": snap.status,
        "consentVersion": snap.consent_version,
        "privacyPolicyVersion": snap.privacy_policy_version,
        "termsVersion": snap.terms_version,
        "appVersion": snap.app_version,
        "createdAt": snap.created_at,
    }


async def get_consent_snapshot(session: AsyncSession, user_id: str) -> list[ConsentSnapshot]:
    async def _load() -> list[ConsentSnapshot]:
        history = await list_consent_history(session, user_id)
        latest: dict[str, ConsentSnapshot] = {}
        for entry in history:
            if entry["purpose"] in latest:
                continue
            latest[entry["purpose"]] = ConsentSnapshot(
                purpose=entry["purpose"],
                status=entry["status"],
                consent_version=entry["consentVersion"],
                privacy_policy_version=entry["privacyPolicyVersion"],
                terms_version=entry["termsVersion"],
                app_version=entry["appVersion"],
                created_at=entry["createdAt"],
            )
        return list(latest.values())

    return await memo_privacy_read(f"consents:{user_id}", _load)


async def record_consent_decision(
    session: AsyncSession,
    *,
    user_id: str,
    purposes: list[str],
    status: str,
    context: ConsentContext,
) -> list[ConsentSnapshot]:
    if not purposes:
        return await get_consent_snapshot(session, user_id)

    invalidate_privacy_read_cache(user_id)

    now = datetime.now(UTC)
    for purpose in purposes:
        session.add(
            PrivacyConsent(
                user_id=user_id,
                purpose=purpose,
                status=status,
                consent_version=CONSENT_VERSION,
                privacy_policy_version=PRIVACY_POLICY_VERSION,
                terms_version=TERMS_VERSION,
                app_version=context.app_version,
                ip_address=context.ip_address,
                user_agent=context.user_agent,
                metadata_=context.metadata or None,
            )
        )
    await session.flush()

    preference_patch: dict[str, bool] = {}
    for purpose in purposes:
        key = PURPOSE_TO_PREFERENCE.get(purpose)
        if key:
            preference_patch[key] = status == "granted"
    if preference_patch:
        await update_privacy_preferences(session, user_id, preference_patch)

    if status == "granted":
        await session.execute(
            update(User)
            .where(User.id == user_id)
            .values(
                consent_version=CONSENT_VERSION,
                consent_timestamp=now,
                privacy_policy_version=PRIVACY_POLICY_VERSION,
                terms_version=TERMS_VERSION,
            )
        )

    return await get_consent_snapshot(session, user_id)