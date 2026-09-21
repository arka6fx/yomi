import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user
from yomi.conf import settings
from yomi.db.models_app2 import PlatformConnection, TelegramLinkToken
from yomi.db.models_auth import User
from yomi.db_session import get_db_session
from yomi.gateway.telegram import recent_gateway_errors
from yomi.gateway.telegram import router as telegram_router

router = APIRouter()
router.include_router(telegram_router, prefix="")

TELEGRAM_LINK_TTL = timedelta(minutes=10)


@router.get("/status")
async def gateway_status():
    return {"running": True, "platform": "telegram"}


@router.get("/debug/errors")
async def gateway_debug_errors():
    return {"errors": recent_gateway_errors()}


@router.get("/connections")
async def list_connections(
    db_session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    rows = (
        await db_session.execute(
            select(PlatformConnection).where(PlatformConnection.user_id == user.id)
        )
    ).scalars()
    return [
        {"platform": row.platform, "connectedAt": row.connected_at.isoformat()} for row in rows
    ]


@router.delete("/connections/{platform}")
async def unlink_connection(
    platform: str,
    db_session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    result = await db_session.execute(
        delete(PlatformConnection).where(
            PlatformConnection.user_id == user.id,
            PlatformConnection.platform == platform,
        )
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="connection not found")
    await db_session.commit()
    return {"ok": True}


@router.post("/telegram/token")
async def create_telegram_link_token(
    db_session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    if not settings.telegram_deep_link_enabled:
        raise HTTPException(status_code=404, detail="telegram linking disabled")
    if not settings.telegram_bot_username:
        raise HTTPException(status_code=500, detail="telegram bot username not configured")

    now = datetime.now(UTC).replace(tzinfo=None)
    token = secrets.token_urlsafe(24)
    db_session.add(
        TelegramLinkToken(
            token=token,
            user_id=user.id,
            created_at=now,
            expires_at=now + TELEGRAM_LINK_TTL,
            used=False,
        )
    )
    await db_session.commit()
    deep_link = f"https://t.me/{settings.telegram_bot_username}?start={token}"
    return {"deepLink": deep_link}