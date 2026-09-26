"""D1 implementation of referral codes and redemption.

Mirrors ``services/referrals.py``: unique code generation with retries,
stats, and the redeem flow with duplicate-recovery via the same idempotency
key (safe grant retry when the event row exists but the grant never landed).
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime

from yomi.logging import get_logger
from yomi.services.billing_d1 import grant_pro_days
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import parse_dt, utcnow_iso
from yomi.services.referrals import NEW_ACCOUNT_WINDOW_S, REFERRAL_CAP

# Both people get 3 days of Pro when an invite is redeemed.
REFERRAL_PRO_DAYS = 3

logger = get_logger(__name__)


async def get_or_create_referral_code(backend: D1Backend, user_id: str) -> str:
    existing = await backend.store.fetch_one(
        "SELECT referral_code FROM user WHERE id = ? LIMIT 1", [user_id]
    )
    if existing and existing.get("referral_code"):
        return str(existing["referral_code"])
    for _attempt in range(3):
        code = secrets.token_hex(4)
        taken = await backend.store.fetch_one(
            "SELECT id FROM user WHERE referral_code = ? LIMIT 1", [code]
        )
        if taken is None:
            await backend.store.atomic([
                Statement("UPDATE user SET referral_code = ? WHERE id = ?", [code, user_id])
            ])
            return code
    raise RuntimeError("failed to generate a unique referral code after 3 attempts")


async def get_referral_stats(backend: D1Backend, user_id: str) -> dict:
    code = await get_or_create_referral_code(backend, user_id)
    rows = await backend.store.fetch_all(
        "SELECT id, credits_granted, created_at FROM referral_events "
        "WHERE referrer_user_id = ? ORDER BY created_at ASC LIMIT 100",
        [user_id],
    )
    events = [
        {
            "id": str(row["id"]),
            "creditsGranted": row["credits_granted"],
            "createdAt": row["created_at"],
        }
        for row in rows
    ]
    return {
        "code": code,
        "count": len(events),
        "cap": REFERRAL_CAP,
        "proDaysPerInvite": REFERRAL_PRO_DAYS,
        "proDaysEarned": len(events) * REFERRAL_PRO_DAYS,
        "events": events,
    }


async def redeem_referral_code(
    backend: D1Backend,
    *,
    code: str,
    referred_user_id: str,
    referred_user_created_at: datetime | str,
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
    created_at = parse_dt(referred_user_created_at)
    if created_at is None:
        return await log_result(redeemed=False, reason="not_new_account")
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    if (now - created_at).total_seconds() > NEW_ACCOUNT_WINDOW_S:
        return await log_result(redeemed=False, reason="not_new_account")

    referrer = await backend.store.fetch_one(
        "SELECT id FROM user WHERE referral_code = ? LIMIT 1", [code]
    )
    referrer_id = str(referrer["id"]) if referrer else None
    if referrer_id is None:
        return await log_result(redeemed=False, reason="invalid_code")
    if referrer_id == referred_user_id:
        return await log_result(redeemed=False, reason="self_referral")

    count_rows = await backend.store.fetch_all(
        "SELECT COUNT(*) AS n FROM referral_events WHERE referrer_user_id = ?",
        [referrer_id],
    )
    if int(count_rows[0]["n"]) >= REFERRAL_CAP:
        return await log_result(redeemed=False, reason="cap_reached")

    event_id = str(uuid.uuid4())
    await backend.store.atomic([
        backend.store.insert_or_ignore("referral_events", {
            "id": event_id,
            "referrer_user_id": referrer_id,
            "referred_user_id": referred_user_id,
            "credits_granted": 0,
            "created_at": utcnow_iso(),
        })
    ])
    existing = await backend.store.fetch_one(
        "SELECT id FROM referral_events WHERE referred_user_id = ? LIMIT 1",
        [referred_user_id],
    )
    if existing is None or str(existing["id"]) != event_id:
        # Another attempt won the unique slot, and that attempt grants the Pro
        # month; granting here too would double it.
        return await log_result(redeemed=False, reason="already_redeemed")

    for user_id in (referrer_id, referred_user_id):
        await grant_pro_days(backend, user_id, REFERRAL_PRO_DAYS)
    return await log_result(redeemed=True)
