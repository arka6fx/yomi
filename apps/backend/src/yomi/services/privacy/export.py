"""Privacy data export — build manifests and manage privacy_exports rows.

Port of apps/backend/src/services/privacy/export.ts.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.db.models_app import (
    AgentMessage,
    MemoryEntry,
    RagSource,
    Schedule,
    UsageEvent,
)
from yomi.db.models_app2 import McpConnection, PlatformConnection, PrivacyExport
from yomi.db.models_auth import Account, Session, User


async def _all(session: AsyncSession, stmt: Any) -> list[dict[str, Any]]:
    result = await session.execute(stmt)
    return [dict(row) for row in result.mappings()]


async def build_manifest(session: AsyncSession, user_id: str) -> dict[str, Any]:
    """Build the full data inventory for a user (PrivacyExport manifest)."""
    user = (
        await session.execute(select(User).where(User.id == user_id).limit(1))
    ).scalar_one_or_none()

    conversations = await _all(
        session,
        select(
            AgentMessage.id.label("id"),
            AgentMessage.session_id.label("sessionId"),
            AgentMessage.role.label("role"),
            AgentMessage.content.label("content"),
            AgentMessage.created_at.label("createdAt"),
        )
        .where(AgentMessage.user_id == user_id)
        .order_by(desc(AgentMessage.created_at))
        .limit(500),
    )
    memories = await _all(
        session,
        select(
            MemoryEntry.id.label("id"),
            MemoryEntry.kind.label("kind"),
            MemoryEntry.topic.label("topic"),
            MemoryEntry.summary.label("summary"),
            MemoryEntry.content.label("content"),
            MemoryEntry.status.label("status"),
            MemoryEntry.confidence.label("confidence"),
            MemoryEntry.created_at.label("createdAt"),
        )
        .where(MemoryEntry.user_id == user_id)
        .order_by(desc(MemoryEntry.created_at))
        .limit(1000),
    )
    rag_sources = await _all(
        session,
        select(
            RagSource.id.label("id"),
            RagSource.name.label("name"),
            RagSource.source_type.label("sourceType"),
            RagSource.status.label("status"),
            RagSource.created_at.label("createdAt"),
        )
        .where(RagSource.user_id == user_id)
        .limit(500),
    )
    connectors = await _all(
        session,
        select(
            McpConnection.id.label("id"),
            McpConnection.provider.label("provider"),
            McpConnection.scopes.label("scopes"),
            McpConnection.display_name.label("displayName"),
            McpConnection.created_at.label("createdAt"),
        ).where(McpConnection.user_id == user_id),
    )
    platforms = await _all(
        session,
        select(
            PlatformConnection.platform.label("platform"),
            PlatformConnection.connected_at.label("connectedAt"),
        ).where(PlatformConnection.user_id == user_id),
    )
    schedules = await _all(
        session,
        select(
            Schedule.id.label("id"),
            Schedule.schedule.label("schedule"),
            Schedule.schedule_type.label("scheduleType"),
            Schedule.prompt.label("prompt"),
            Schedule.enabled.label("enabled"),
            Schedule.created_at.label("createdAt"),
        ).where(Schedule.user_id == user_id),
    )
    usage = await _all(
        session,
        select(
            UsageEvent.id.label("id"),
            UsageEvent.kind.label("kind"),
            UsageEvent.cost_cents.label("costCents"),
            UsageEvent.credits_charged.label("creditsCharged"),
            UsageEvent.created_at.label("createdAt"),
        )
        .where(UsageEvent.user_id == user_id)
        .order_by(desc(UsageEvent.created_at))
        .limit(1000),
    )
    sessions = await _all(
        session,
        select(
            Session.id.label("id"),
            Session.created_at.label("createdAt"),
        ).where(Session.user_id == user_id),
    )
    accounts = await _all(
        session,
        select(
            Account.id.label("id"),
            Account.provider_id.label("providerId"),
            Account.scope.label("scope"),
        ).where(Account.user_id == user_id),
    )

    profile: dict[str, Any] = {}
    if user is not None:
        profile = {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "plan": user.plan,
            "role": user.role,
            "subscriptionStatus": user.subscription_status,
            "createdAt": user.created_at,
            "consentVersion": user.consent_version,
            "consentTimestamp": user.consent_timestamp,
        }

    return {
        "profile": profile,
        "sessions": sessions,
        "accounts": accounts,
        "conversations": conversations,
        "memories": memories,
        "ragSources": rag_sources,
        "connectors": connectors,
        "platforms": platforms,
        "schedules": schedules,
        "usage": usage,
    }


def _export_dict(row: PrivacyExport) -> dict[str, Any]:
    return {
        "id": row.id,
        "userId": row.user_id,
        "status": row.status,
        "format": row.format,
        "manifest": row.manifest,
        "archiveUrl": row.archive_url,
        "archiveSha256": row.archive_sha256,
        "error": row.error,
        "requestedAt": row.requested_at,
        "completedAt": row.completed_at,
        "expiresAt": row.expires_at,
    }


async def _update_export(
    session: AsyncSession,
    export_id: uuid.UUID,
    values: dict[str, Any],
) -> PrivacyExport | None:
    row = (
        await session.execute(
            update(PrivacyExport)
            .where(PrivacyExport.id == export_id)
            .values(**values)
            .returning(PrivacyExport)
        )
    ).scalar_one_or_none()
    return row


async def request_export(
    session: AsyncSession, user_id: str, format: str = "json"
) -> dict[str, Any] | None:
    existing = (
        await session.execute(
            select(PrivacyExport)
            .where(PrivacyExport.user_id == user_id)
            .order_by(desc(PrivacyExport.requested_at))
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None and existing.status in ("queued", "processing"):
        return _export_dict(existing)

    session.add(PrivacyExport(user_id=user_id, format=format, status="processing"))
    await session.flush()
    new_id: uuid.UUID | None = None
    for obj in session.new:
        if isinstance(obj, PrivacyExport):
            new_id = obj.id
            break
    if new_id is None:
        return None

    try:
        manifest = await build_manifest(session, user_id)
        updated = await _update_export(
            session,
            new_id,
            {
                "status": "completed",
                "manifest": manifest,
                "completed_at": datetime.now(UTC),
                "expires_at": datetime.now(UTC) + timedelta(days=7),
            },
        )
    except Exception as err:
        updated = await _update_export(
            session,
            new_id,
            {"status": "failed", "error": str(err)},
        )
    return _export_dict(updated) if updated is not None else None


async def get_export(
    session: AsyncSession, user_id: str, export_id: str
) -> dict[str, Any] | None:
    row = (
        await session.execute(
            select(PrivacyExport).where(PrivacyExport.id == export_id).limit(1)
        )
    ).scalar_one_or_none()
    if row is None or row.user_id != user_id:
        return None
    return _export_dict(row)


async def list_exports(session: AsyncSession, user_id: str) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(
                PrivacyExport.id.label("id"),
                PrivacyExport.status.label("status"),
                PrivacyExport.format.label("format"),
                PrivacyExport.error.label("error"),
                PrivacyExport.requested_at.label("requestedAt"),
                PrivacyExport.completed_at.label("completedAt"),
                PrivacyExport.expires_at.label("expiresAt"),
            )
            .where(PrivacyExport.user_id == user_id)
            .order_by(desc(PrivacyExport.requested_at))
        )
    ).mappings()
    return [dict(row) for row in rows]