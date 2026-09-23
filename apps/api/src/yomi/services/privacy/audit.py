"""Privacy audit trail with PII-redacted metadata.

Port of apps/api/src/services/privacy/audit.ts. Request-context helpers
(client_ip / user_agent) take a FastAPI Request.
"""

from __future__ import annotations

from typing import Any

from fastapi import Request
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.db.models_app2 import PrivacyAuditEvent

AuditMetadata = dict[str, str | int | float | bool | None | list[str]]

BLOCKED_METADATA_KEYS = (
    "accessToken",
    "refreshToken",
    "idToken",
    "token",
    "apiKey",
    "password",
    "secret",
    "prompt",
    "content",
    "conversation",
    "screenshot",
    "attachment",
    "email",
)


def client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip() or None
    return request.client.host if request.client else None


def user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _is_safe_metadata_key(key: str) -> bool:
    normalized = key.lower()
    return not any(blocked.lower() in normalized for blocked in BLOCKED_METADATA_KEYS)


def sanitize_audit_metadata(metadata: AuditMetadata | None) -> AuditMetadata | None:
    if not metadata:
        return None
    safe: AuditMetadata = {}
    for key, value in metadata.items():
        if not _is_safe_metadata_key(key):
            continue
        safe[key] = value
    return safe if safe else None


async def record_privacy_audit_event(
    session: AsyncSession,
    *,
    actor_user_id: str | None = None,
    target_user_id: str | None = None,
    event_type: str,
    resource_type: str | None = None,
    resource_id: str | None = None,
    ip_address: str | None = None,
    ua: str | None = None,
    metadata: AuditMetadata | None = None,
) -> None:
    session.add(
        PrivacyAuditEvent(
            actor_user_id=actor_user_id,
            target_user_id=target_user_id if target_user_id is not None else actor_user_id,
            event_type=event_type,
            resource_type=resource_type,
            resource_id=resource_id,
            ip_address=ip_address,
            user_agent=ua,
            metadata_=sanitize_audit_metadata(metadata),
        )
    )
    await session.flush()


async def list_privacy_activity(
    session: AsyncSession, user_id: str, limit: int
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(PrivacyAuditEvent)
            .where(PrivacyAuditEvent.target_user_id == user_id)
            .order_by(desc(PrivacyAuditEvent.created_at))
            .limit(limit)
        )
    ).scalars()
    return [
        {
            "id": str(row.id),
            "eventType": row.event_type,
            "resourceType": row.resource_type,
            "resourceId": row.resource_id,
            "metadata": row.metadata_,
            "createdAt": row.created_at,
        }
        for row in rows
    ]