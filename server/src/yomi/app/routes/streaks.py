"""/api/streaks router.

Port of apps/backend/src/routes/streaks.ts.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.db.models_auth import User
from yomi.services.streaks import get_leaderboard, get_streak_stats, set_leaderboard_opt_in

streaks_router = APIRouter(prefix="/api/streaks")


@streaks_router.get("/me")
async def me(
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    return await get_streak_stats(session, user.id)


@streaks_router.post("/opt-in")
async def opt_in(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 — Hono's c.req.json().catch(() => ({}))
        body = {}
    opt_in = body.get("optIn") if isinstance(body, dict) else None
    if not isinstance(opt_in, bool):
        return JSONResponse(
            {"error": "optIn must be a boolean", "code": "invalid_opt_in"}, 400
        )
    return await set_leaderboard_opt_in(session, user.id, opt_in)


@streaks_router.get("/leaderboard")
async def leaderboard(
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    return await get_leaderboard(session, user.id)