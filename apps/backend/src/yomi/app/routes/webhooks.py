"""Inbound Composio webhooks (connection lifecycle + trigger messages).

Verifies the HMAC signature via ``composio.triggers.parse`` (secret from
``COMPOSIO_WEBHOOK_SECRET``) and applies the event to the local
``composio_connections`` mirror. Trigger messages only bump
``last_trigger_event_at`` — trigger payload data is never stored (PII).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.conf import settings
from yomi.connectors.composio import (
    ConnectorError,
    get_composio,
    handle_webhook_event,
    parse_webhook,
)
from yomi.db_session import get_db_session

logger = logging.getLogger(__name__)

webhooks_router = APIRouter(prefix="/api/webhooks")


@webhooks_router.post("/composio")
async def composio_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
):
    raw_body = await request.body()
    if get_composio() is None:
        raise HTTPException(status_code=503, detail="Composio is not configured on this server")

    verify_secret = settings.composio_webhook_secret
    if settings.environment == "production" and not verify_secret:
        raise HTTPException(
            status_code=503,
            detail="COMPOSIO_WEBHOOK_SECRET is not set on this server",
        )

    try:
        parsed = await parse_webhook(raw_body, request.headers, verify_secret=verify_secret or None)
    except ConnectorError as err:
        raise HTTPException(status_code=401, detail=str(err)) from err

    raw = parsed.get("raw_payload")
    normalized = parsed.get("payload")
    if raw is None:
        raise HTTPException(status_code=400, detail="Malformed webhook payload")
    result = await handle_webhook_event(db, raw, normalized)
    logger.info("composio webhook handled: %s", result)
    return {"status": "ok", **result}