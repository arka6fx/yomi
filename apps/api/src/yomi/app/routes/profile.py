"""/api/user — profile router.

Port of apps/api/src/routes/profile.ts.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.db.models_auth import User
from yomi.services import streaks_d1
from yomi.services.auth_d1 import update_user_fields
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend
from yomi.services.streaks import set_leaderboard_show_photo, update_leaderboard_handle

profile_router = APIRouter(prefix="/api/user")


@profile_router.get("/me")
async def me(user: User = Depends(get_current_user)) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "plan": user.plan,
        "role": user.role,
        "agentSoul": user.agent_soul,
    }


@profile_router.patch("/profile")
async def update_profile(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 — Hono's c.req.json().catch(() => ({}))
        body = {}

    if not isinstance(body, dict):
        body = {}

    if body.get("name") is None and body.get("agentSoul") is None:
        return JSONResponse({"error": "name or agentSoul is required", "code": "invalid_body"}, 400)

    update_values: dict[str, str] = {}

    name = body.get("name")
    if name is not None:
        trimmed = str(name).strip()
        if not trimmed:
            return JSONResponse({"error": "Name is required", "code": "invalid_name"}, 400)
        if len(trimmed) > 80:
            return JSONResponse(
                {"error": "Name must be 80 characters or fewer", "code": "invalid_name"}, 400
            )
        update_values["name"] = trimmed

    agent_soul = body.get("agentSoul")
    if agent_soul is not None:
        trimmed = str(agent_soul).strip()
        if len(trimmed) > 2000:
            return JSONResponse(
                {
                    "error": "Writing style must be 2000 characters or fewer",
                    "code": "invalid_agent_soul",
                },
                400,
            )
        update_values["agent_soul"] = trimmed

    if d1 is not None:
        updated = await update_user_fields(d1, user.id, update_values)
        if updated is None:
            return JSONResponse({"error": "User not found"}, 404)
        return {
            "name": updated["name"],
            "email": updated["email"],
            "agentSoul": updated.get("agent_soul"),
        }
    await session.execute(update(User).where(User.id == user.id).values(**update_values))
    updated = (
        await session.execute(
            select(User.name, User.email, User.agent_soul).where(User.id == user.id)
        )
    ).one_or_none()

    if updated is None:
        return JSONResponse({"error": "User not found"}, 404)

    return {"name": updated.name, "email": updated.email, "agentSoul": updated.agent_soul}


@profile_router.post("/handle")
async def set_handle(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    handle = body.get("handle") if isinstance(body, dict) else None
    if not isinstance(handle, str) or not handle.strip():
        return JSONResponse({"error": "handle is required", "code": "invalid_handle"}, 400)

    if d1 is not None:
        result = await streaks_d1.update_leaderboard_handle(d1, user.id, handle)
    else:
        result = await update_leaderboard_handle(session, user.id, handle)
    if not result["ok"]:
        return JSONResponse({"error": result["error"], "code": "invalid_handle"}, 400)
    return {"leaderboardHandle": result["leaderboardHandle"]}


@profile_router.post("/show-photo")
async def set_show_photo(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    show_photo = body.get("showPhoto") if isinstance(body, dict) else None
    if not isinstance(show_photo, bool):
        return JSONResponse(
            {"error": "showPhoto must be a boolean", "code": "invalid_show_photo"}, 400
        )
    if d1 is not None:
        return await streaks_d1.set_leaderboard_show_photo(d1, user.id, show_photo)
    result = await set_leaderboard_show_photo(session, user.id, show_photo)
    return result