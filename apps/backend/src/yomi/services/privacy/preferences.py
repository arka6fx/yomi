"""Privacy preferences store with a short-lived read cache.

Port of apps/backend/src/services/privacy/preferences.ts.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, TypeVar

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.db.models_app2 import PrivacyPreference

T = TypeVar("T")

# The consent store is read repeatedly inside a single Telegram turn — once for
# conversation_history in the gateway and again for memory + cloud_memory in the
# agent loop — and every check re-reads both the preferences row and the full
# consent history. Memoize briefly and drop the entry on any write, so a
# decision made in this process is never masked.
READ_CACHE_TTL_S = 2.0
_read_cache: dict[str, tuple[float, Any]] = {}


async def memo_privacy_read(key: str, load: Callable[[], Awaitable[T]]) -> T:
    hit = _read_cache.get(key)
    if hit is not None and time.monotonic() - hit[0] < READ_CACHE_TTL_S:
        return hit[1]
    try:
        value = await load()
    except Exception:
        _read_cache.pop(key, None)
        raise
    _read_cache[key] = (time.monotonic(), value)
    return value


def invalidate_privacy_read_cache(user_id: str) -> None:
    _read_cache.pop(f"prefs:{user_id}", None)
    _read_cache.pop(f"consents:{user_id}", None)


@dataclass
class PrivacyPreferencesShape:
    conversation_history_enabled: bool = False
    memory_enabled: bool = False
    cloud_memory_enabled: bool = False
    connectors_enabled: bool = False
    analytics_enabled: bool = False
    voice_processing_enabled: bool = False
    ai_improvement_enabled: bool = False
    telegram_processing_enabled: bool = False
    retention_overrides: dict[str, Any] | None = None
    updated_at: datetime | None = field(default=None)


DEFAULT_PREFERENCES = PrivacyPreferencesShape(updated_at=datetime(1970, 1, 1, tzinfo=UTC))

BOOLEAN_PREFERENCE_KEYS = (
    "conversation_history_enabled",
    "memory_enabled",
    "cloud_memory_enabled",
    "connectors_enabled",
    "analytics_enabled",
    "voice_processing_enabled",
    "ai_improvement_enabled",
    "telegram_processing_enabled",
)

# camelCase keys matching the TS PrivacyPreferencesShape serialization.
_CAMEL_KEYS = (
    "conversationHistoryEnabled",
    "memoryEnabled",
    "cloudMemoryEnabled",
    "connectorsEnabled",
    "analyticsEnabled",
    "voiceProcessingEnabled",
    "aiImprovementEnabled",
    "telegramProcessingEnabled",
)


def shape_to_dict(shape: PrivacyPreferencesShape) -> dict[str, object]:
    """Serialize the shape to the TS wire format (camelCase keys)."""
    out: dict[str, object] = {
        camel: getattr(shape, snake)
        for snake, camel in zip(BOOLEAN_PREFERENCE_KEYS, _CAMEL_KEYS, strict=True)
    }
    out["retentionOverrides"] = shape.retention_overrides
    out["updatedAt"] = shape.updated_at
    return out


def _serialize(pref: PrivacyPreference) -> PrivacyPreferencesShape:
    return PrivacyPreferencesShape(
        conversation_history_enabled=pref.conversation_history_enabled,
        memory_enabled=pref.memory_enabled,
        cloud_memory_enabled=pref.cloud_memory_enabled,
        connectors_enabled=pref.connectors_enabled,
        analytics_enabled=pref.analytics_enabled,
        voice_processing_enabled=pref.voice_processing_enabled,
        ai_improvement_enabled=pref.ai_improvement_enabled,
        telegram_processing_enabled=pref.telegram_processing_enabled,
        retention_overrides=pref.retention_overrides,
        updated_at=pref.updated_at,
    )


async def get_privacy_preferences(
    session: AsyncSession, user_id: str
) -> PrivacyPreferencesShape:
    async def _load() -> PrivacyPreferencesShape:
        row = (
            await session.execute(
                select(PrivacyPreference).where(PrivacyPreference.user_id == user_id).limit(1)
            )
        ).scalar_one_or_none()
        return _serialize(row) if row is not None else DEFAULT_PREFERENCES

    return await memo_privacy_read(f"prefs:{user_id}", _load)


async def update_privacy_preferences(
    session: AsyncSession,
    user_id: str,
    patch: dict[str, bool | dict[str, Any] | None],
) -> PrivacyPreferencesShape:
    """Upsert a preference patch (boolean keys + optional retentionOverrides)."""
    invalidate_privacy_read_cache(user_id)
    now = datetime.now(UTC)
    values: dict[str, object] = {**patch, "user_id": user_id, "updated_at": now}

    stmt = (
        pg_insert(PrivacyPreference)
        .values(**values)
        .on_conflict_do_update(
            index_elements=[PrivacyPreference.user_id],
            set_={**patch, "updated_at": now},
        )
        .returning(PrivacyPreference)
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None:
        return await get_privacy_preferences(session, user_id)
    return _serialize(row)