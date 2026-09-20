"""Consent gate for protected routes.

Port of apps/backend/src/middleware/consent.ts, expressed as a FastAPI
dependency factory.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.db.models_auth import User
from yomi.services.privacy.checks import check_consent


def require_consent(purpose: str) -> Callable[..., Awaitable[None]]:
    async def dependency(
        user: User = Depends(get_current_user),
        session: AsyncSession = Depends(get_db_session),
    ) -> None:
        result = await check_consent(session, user.id, purpose)
        if not result.allowed:
            raise HTTPException(status_code=403, detail=f"Consent required: {result.reason}")

    return dependency