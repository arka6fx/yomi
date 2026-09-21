"""Request dependencies: DB session + Better Auth session-cookie auth seam.

Authentication mirrors the live better-auth v1.2.x contract: reads the
`__Secure-yomi.session_token` / `yomi.session_token` cookie (or
`Authorization: Bearer <token>`), recovers the session token from the signed
cookie value, looks up the session row, and returns the user. See
yomi.services.session_cookie for the exact wire format.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.conf import settings
from yomi.db.models_auth import Session as AuthSession
from yomi.db.models_auth import User
from yomi.db_session import get_db_session
from yomi.services.session_cookie import read_session_cookie, recover_token

logger = logging.getLogger(__name__)


def _extract_session_token(request: Request) -> str | None:
    header = request.headers.get("authorization")
    if header and header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return read_session_cookie(request)


def _recover_session_token(value: str) -> str | None:
    """Recover the DB lookup key for a signed cookie value (current or legacy scheme)."""
    return recover_token(settings.better_auth_secret, value)


async def get_current_user(
    request: Request, session: AsyncSession = Depends(get_db_session)
) -> User:
    token = _extract_session_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    lookup = _recover_session_token(token)
    if not lookup:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    auth_session = (
        await session.execute(select(AuthSession).where(AuthSession.token == lookup).limit(1))
    ).scalar_one_or_none()
    if auth_session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session not found")

    expires = auth_session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if expires < datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")

    user = (
        await session.execute(select(User).where(User.id == auth_session.user_id).limit(1))
    ).scalar_one_or_none()
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    request.state.user = user
    return user