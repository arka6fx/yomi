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
from yomi.services.cloudflare_storage.deps import use_d1
from yomi.services.session_cookie import read_session_cookie, recover_token

logger = logging.getLogger(__name__)


def _extract_session_token(request: Request) -> str | None:
    header = request.headers.get("authorization")
    if header and header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return read_session_cookie(request)


def _recover_session_token(value: str) -> str | None:
    """Recover the DB lookup key for a Bearer token or signed cookie value.

    Accepts the raw `session.token` (what better-auth returns to clients and
    what the dashboard sends as `Authorization: Bearer <token>`) directly, or
    recovers the raw token from a signed cookie value (current or legacy
    scheme). Signed cookies always contain a `.` separator, so the two forms
    are unambiguous.
    """
    if "." not in value:
        return value or None
    return recover_token(settings.better_auth_secret, value)


async def _load_user(token: str, request: Request, session: AsyncSession) -> User:
    lookup = _recover_session_token(token)
    if not lookup:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    if use_d1():
        import httpx as _httpx

        from yomi.services import auth_d1 as _auth_d1
        from yomi.services.cloudflare_storage.client import StorageClient as _StorageClient
        from yomi.services.cloudflare_storage.deps import D1Backend as _D1Backend
        from yomi.services.cloudflare_storage.store import D1Store as _D1Store

        try:
            async with _httpx.AsyncClient() as http:
                client = _StorageClient.configured(http)
                user = await _auth_d1.load_request_user(
                    _D1Backend(store=_D1Store(client), client=client), lookup, request=request
                )
        except ValueError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        request.state.user = user
        return user

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


async def get_current_user(
    request: Request, session: AsyncSession = Depends(get_db_session)
) -> User:
    token = _extract_session_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return await _load_user(token, request, session)


async def get_current_user_query(
    request: Request, session: AsyncSession = Depends(get_db_session)
) -> User:
    """Same as :func:`get_current_user` but accepts ``?session=<token>``.

    Dashboard connector connects open in a new tab (no Authorization header is
    sent), so the session token arrives as a query parameter. Header/cookie are
    still honoured as fallbacks.
    """
    query_token = request.query_params.get("session")
    token = query_token or _extract_session_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return await _load_user(token, request, session)