"""/api/referrals router.

Port of apps/backend/src/routes/referrals.ts.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.db.models_auth import User
from yomi.services import referrals_d1
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend
from yomi.services.referrals import get_referral_stats, redeem_referral_code

referrals_router = APIRouter(prefix="/api/referrals")


@referrals_router.get("/me")
async def me(
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        return await referrals_d1.get_referral_stats(d1, user.id)
    return await get_referral_stats(session, user.id)


@referrals_router.post("/redeem")
async def redeem(
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
    code = body.get("code")
    code = code.strip() if isinstance(code, str) else ""
    if not code:
        return JSONResponse({"error": "code is required", "code": "invalid_code"}, 400)
    if user.created_at is None:
        return JSONResponse(
            {"error": "account creation time unavailable", "code": "invalid_account_state"}, 400
        )
    if d1 is not None:
        return await referrals_d1.redeem_referral_code(
            d1,
            code=code,
            referred_user_id=user.id,
            referred_user_created_at=user.created_at,
        )

    return await redeem_referral_code(
        session,
        code=code,
        referred_user_id=user.id,
        referred_user_created_at=user.created_at,
    )