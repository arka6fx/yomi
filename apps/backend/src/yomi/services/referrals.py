"""Referral codes and redemption.

Port of apps/backend/src/services/referrals.ts.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.db.models_app import ReferralEvent
from yomi.db.models_auth import User
from yomi.logging import get_logger
from yomi.services.credit_ledger import grant_credits

logger = get_logger(__name__)

REFERRAL_CREDIT_AMOUNT = 100
REFERRAL_CAP = 20
NEW_ACCOUNT_WINDOW_S = 15 * 60


def is_duplicate_referral_code_error(err: Exception) -> bool:
    return "user_referral_code_unique" in str(err)


def is_duplicate_referred_user_error(err: Exception) -> bool:
    return "referral_events_referred_user_id_unique" in str(err)


async def get_or_create_referral_code(session: AsyncSession, user_id: str) -> str:
    existing = (
        await session.execute(select(User.referral_code).where(User.id == user_id).limit(1))
    ).scalar_one_or_none()
    if existing:
        return existing

    for _attempt in range(3):
        code = secrets.token_hex(4)
        try:
            await session.execute(
                update(User).where(User.id == user_id).values(referral_code=code)
            )
            await session.flush()
            return code
        except Exception as err:  # noqa: BLE001 — normalized below; nothing else thrown here
            if not is_duplicate_referral_code_error(err):  # type: ignore[arg-type]
                raise
    raise RuntimeError("failed to generate a unique referral code after 3 attempts")


async def get_referral_stats(session: AsyncSession, user_id: str) -> dict:
    code = await get_or_create_referral_code(session, user_id)
    rows = (
        await session.execute(
            select(ReferralEvent)
            .where(ReferralEvent.referrer_user_id == user_id)
            .order_by(ReferralEvent.created_at)
            .limit(100)
        )
    ).scalars()

    events = [
        {"id": str(row.id), "creditsGranted": row.credits_granted, "createdAt": row.created_at}
        for row in rows
    ]
    return {
        "code": code,
        "count": len(events),
        "cap": REFERRAL_CAP,
        "creditsEarned": sum(e["creditsGranted"] for e in events),
        "events": events,
    }


async def redeem_referral_code(
    session: AsyncSession,
    *,
    code: str,
    referred_user_id: str,
    referred_user_created_at: datetime,
) -> dict:
    async def log_result(*, redeemed: bool, reason: str | None = None) -> dict:
        logger.info(
            "[referral] redeem redeemed=%s reason=%s referredUserId=%s",
            redeemed,
            reason,
            referred_user_id,
        )
        return {"redeemed": redeemed, **({"reason": reason} if reason else {})}

    now = datetime.now(UTC)
    created_at = referred_user_created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    if (now - created_at).total_seconds() > NEW_ACCOUNT_WINDOW_S:
        return await log_result(redeemed=False, reason="not_new_account")

    referrer_id = (
        await session.execute(
            select(User.id).where(User.referral_code == code).limit(1)
        )
    ).scalar_one_or_none()
    if referrer_id is None:
        return await log_result(redeemed=False, reason="invalid_code")
    if referrer_id == referred_user_id:
        return await log_result(redeemed=False, reason="self_referral")

    count = (
        await session.execute(
            select(func.count())
            .select_from(ReferralEvent)
            .where(ReferralEvent.referrer_user_id == referrer_id)
        )
    ).scalar_one()
    if count >= REFERRAL_CAP:
        return await log_result(redeemed=False, reason="cap_reached")

    try:
        event = ReferralEvent(
            referrer_user_id=referrer_id,
            referred_user_id=referred_user_id,
            credits_granted=REFERRAL_CREDIT_AMOUNT,
        )
        session.add(event)
        await session.flush()
        event_id = event.id
    except Exception as err:  # noqa: BLE001 — duplicate-key handling below
        if not is_duplicate_referred_user_error(err):  # type: ignore[arg-type]
            raise
        # A prior attempt already inserted the referralEvents row (guaranteed
        # unique by referred_user_id), but grantCredits may never have completed
        # for it. Look up that row and retry the grant with the same
        # idempotencyKey — grantCredits is idempotent on idempotencyKey, so this
        # is a safe no-op if the grant already landed.
        existing = (
            await session.execute(
                select(ReferralEvent.id)
                .where(ReferralEvent.referred_user_id == referred_user_id)
                .limit(1)
            )
        ).scalar_one_or_none()
        if existing is not None:
            await grant_credits(
                session,
                user_id=referrer_id,
                amount=REFERRAL_CREDIT_AMOUNT,
                source="referral",
                source_id=f"referral:{existing}",
                idempotency_key=f"referral:{existing}:credit",
                reason="referral_bonus",
            )
        return await log_result(redeemed=False, reason="already_redeemed")

    await grant_credits(
        session,
        user_id=referrer_id,
        amount=REFERRAL_CREDIT_AMOUNT,
        source="referral",
        source_id=f"referral:{event_id}",
        idempotency_key=f"referral:{event_id}:credit",
        reason="referral_bonus",
    )
    return await log_result(redeemed=True)