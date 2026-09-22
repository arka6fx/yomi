"""/api/streaks router.

Port of apps/backend/src/routes/streaks.ts.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.db.models_auth import User
from yomi.services import streaks_d1
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend
from yomi.services.streaks import get_leaderboard, get_streak_stats, set_leaderboard_opt_in

streaks_router = APIRouter(prefix="/api/streaks")


@streaks_router.get("/me")
async def me(
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        return await streaks_d1.get_streak_stats(d1, user.id)
    return await get_streak_stats(session, user.id)


@streaks_router.post("/opt-in")
async def opt_in(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
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
    if d1 is not None:
        return await streaks_d1.set_leaderboard_opt_in(d1, user.id, opt_in)
    return await set_leaderboard_opt_in(session, user.id, opt_in)


@streaks_router.get("/leaderboard")
async def leaderboard(
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        return await streaks_d1.get_leaderboard(d1, user.id)
    return await get_leaderboard(session, user.id)