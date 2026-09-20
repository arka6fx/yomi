"""Request dependencies: DB session + Better Auth session-cookie auth seam.

Authentication mirrors apps/backend/src/auth.ts: reads the `yomi.session_token`
cookie (or `Authorization: Bearer <token>`), verifies the HMAC signature, looks
up the session row, and returns the user. Better Auth's stable cookie name for
this app is `yomi.session_token`.
"""

from __future__ import annotations

import hashlib
import hmac as hmac_mod
import json
import logging
from datetime import UTC, datetime

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.conf import settings
from yomi.db.models_auth import Session as AuthSession
from yomi.db.models_auth import User
from yomi.db_session import get_db_session

logger = logging.getLogger(__name__)

AUTH_COOKIE_NAME = "yomi.session_token"


def _extract_session_token(request: Request) -> str | None:
    header = request.headers.get("authorization")
    if header and header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return request.cookies.get(AUTH_COOKIE_NAME)


def _verify_session_signature(token: str) -> bool:
    """Better Auth signs session tokens as `<random>.<hmac_sha256_hex>` where the
    signature is HMAC-SHA256 of JSON.stringify({token}) with BETTER_AUTH_SECRET.
    When no secret is configured (local dev), verification is skipped."""
    secret = settings.better_auth_secret
    if not secret:
        return True
    if "." not in token:
        return False
    t, sig = token.rsplit(".", 1)
    body = json.dumps({"token": t}, separators=(",", ":"))
    expected = hmac_mod.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    return hmac_mod.compare_digest(sig, expected)


async def get_current_user(
    request: Request, session: AsyncSession = Depends(get_db_session)
) -> User:
    token = _extract_session_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    if not _verify_session_signature(token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session")

    auth_session = (
        await session.execute(select(AuthSession).where(AuthSession.token == token).limit(1))
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