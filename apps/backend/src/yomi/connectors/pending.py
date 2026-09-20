"""Pending-action creation: durable rows the approval surface resolves later."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from yomi.db.models_app2 import PendingAction

PENDING_TTL = timedelta(days=7)


def create_pending_action(
    db: AsyncSession,
    *,
    user_id: str,
    source_platform: str | None = None,
    source_chat_id: str | None = None,
    requested_by_run_id: uuid.UUID | None = None,
) -> Callable[[dict], Awaitable[dict]]:
    """Build the `create_pending_action` hook a ConnectorContext expects."""

    async def creator(meta: dict[str, Any]) -> dict[str, Any]:
        row = PendingAction(
            user_id=user_id,
            connector=meta["connector"],
            action=meta["action"],
            risk=meta["risk"],
            title=meta["title"],
            preview=meta["preview"],
            confirm_text=meta.get("confirm_text"),
            payload=meta["payload"],
            status="pending",
            source_platform=source_platform,
            source_chat_id=source_chat_id,
            requested_by_run_id=requested_by_run_id,
            expires_at=datetime.now(UTC) + PENDING_TTL,
        )
        db.add(row)
        await db.flush()
        return {
            "id": str(row.id),
            "status": "pending",
            "message": f"{meta['title']} — waiting for your approval.",
        }

    return creator