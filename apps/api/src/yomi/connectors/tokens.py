"""DB-backed access-token resolution for connector providers.

Ported from the backend registry's TokenProvider seam: OAuth tokens live
encrypted on `mcp_connections` and are decrypted here on demand. Google tokens
are refreshed (and re-encrypted) when they are about to expire.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.connectors.base import ConnectorError
from yomi.crypto import decrypt_tokens, encrypt_tokens, refresh_google_access_token
from yomi.db.models_app2 import McpConnection

# Refresh early so a slow multi-turn loop still holds a live token.
_REFRESH_MARGIN_MS = 60_000
_GOOGLE_PROVIDERS = frozenset({"google", "google-calendar", "google-drive"})


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return True


async def get_access_token(db: AsyncSession, user_id: str, provider: str) -> str:
    """Return a live API token for the given user/provider, or raise ConnectorError."""
    if not _is_uuid(user_id):
        # mcp_connections.user_id is a uuid column; other ids simply have no rows.
        raise ConnectorError(f"{provider} is not connected")
    conn = (
        await db.execute(
            select(McpConnection).where(
                McpConnection.user_id == user_id, McpConnection.provider == provider
            )
        )
    ).scalar_one_or_none()
    if conn is None:
        raise ConnectorError(f"{provider} is not connected")
    tokens = decrypt_tokens(conn.oauth_tokens)
    expires = tokens.expires_at
    if (
        provider in _GOOGLE_PROVIDERS
        and tokens.refresh_token
        and expires is not None
        and expires - _REFRESH_MARGIN_MS <= int(time.time() * 1000)
    ):
        refreshed = await refresh_google_access_token(tokens.refresh_token)
        conn.oauth_tokens = encrypt_tokens(refreshed)
        await db.flush()
        return refreshed.access_token
    return tokens.access_token


def token_provider(db: AsyncSession) -> Callable[[str, str], Awaitable[str]]:
    """Build a `get_access_token(user_id, provider)` callable bound to the session."""

    async def _get(user_id: str, provider: str) -> str:
        return await get_access_token(db, user_id, provider)

    return _get