"""Credit ledger operations.

Port of apps/backend/src/services/credit-ledger.ts. Async-first, one session per
call, idempotency via idempotency_key transactions + unique constraints.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import and_, desc, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.db.models_app import (
    CreditAccount,
    CreditGrant,
    CreditTransaction,
    PaymentRecord,
    UsageEvent,
)

logger = logging.getLogger(__name__)

CreditMetadata = dict[str, object]

CreditGrantSource = Literal[
    "subscription_cycle",
    "credit_pack",
    "admin_adjustment",
    "refund",
    "migration",
    "promo",
    "referral",
]
CreditDebitType = Literal["consume", "refund", "adjustment", "expire"]


def _utc_naive(dt: datetime | None) -> datetime | None:
    """Strip tzinfo for naive TIMESTAMP columns; asyncpg rejects aware values."""
    return dt.replace(tzinfo=None) if dt is not None and dt.tzinfo else dt


@dataclass
class CreditSummary:
    balance: int
    lifetime_granted: int
    lifetime_consumed: int
    lifetime_refunded: int
    expiring_soon: int
    expiring_soon_at: datetime | None


@dataclass
class DebitResult:
    ok: bool
    charged: int = 0
    balance: int = 0
    insufficient: bool = False


@dataclass
class GrantResult:
    granted: bool
    balance: int


async def ensure_credit_account(session: AsyncSession, user_id: str) -> None:
    await session.execute(
        pg_insert(CreditAccount).values(user_id=user_id).on_conflict_do_nothing()
    )


async def transaction_by_key(
    session: AsyncSession, idempotency_key: str
) -> CreditTransaction | None:
    res = await session.execute(
        select(
            CreditTransaction.amount, CreditTransaction.balance_after
        ).where(CreditTransaction.idempotency_key == idempotency_key).limit(1)
    )
    return res.scalar_one_or_none()


async def get_credit_summary(session: AsyncSession, user_id: str) -> CreditSummary:
    await ensure_credit_account(session, user_id)

    account = (
        await session.execute(
            select(CreditAccount).where(CreditAccount.user_id == user_id).limit(1)
        )
    ).scalar_one_or_none()

    now = _utc_naive(datetime.now(UTC))
    assert now is not None
    soon = now + timedelta(days=7)

    expiring = (
        await session.execute(
            select(
                func.coalesce(func.sum(CreditGrant.credits_remaining), 0),
                func.min(CreditGrant.expires_at),
            ).where(
                and_(
                    CreditGrant.user_id == user_id,
                    CreditGrant.status == "active",
                    CreditGrant.credits_remaining > 0,
                    CreditGrant.expires_at > now,
                    CreditGrant.expires_at <= soon,
                )
            )
        )
    ).one()

    return CreditSummary(
        balance=account.available_credits if account else 0,
        lifetime_granted=account.lifetime_granted if account else 0,
        lifetime_consumed=account.lifetime_consumed if account else 0,
        lifetime_refunded=account.lifetime_refunded if account else 0,
        expiring_soon=int(expiring[0] or 0),
        expiring_soon_at=expiring[1],
    )


async def recent_credit_transactions(
    session: AsyncSession, user_id: str, limit: int = 20
) -> list[dict]:
    res = await session.execute(
        select(
            CreditTransaction.id,
            CreditTransaction.type,
            CreditTransaction.amount,
            CreditTransaction.balance_after,
            CreditTransaction.reason,
            CreditTransaction.usage_event_id,
            UsageEvent.kind.label("usage_kind"),
            UsageEvent.credits_charged.label("usage_credits_charged"),
            UsageEvent.created_at.label("usage_created_at"),
            CreditTransaction.created_at,
        )
        .outerjoin(UsageEvent, UsageEvent.id == CreditTransaction.usage_event_id)
        .where(CreditTransaction.user_id == user_id)
        .order_by(desc(CreditTransaction.created_at))
        .limit(limit)
    )
    return [dict(row) for row in res.all()]


async def create_payment_record(
    session: AsyncSession,
    *,
    user_id: str,
    provider: str,
    kind: str,
    product_key: str,
    provider_customer_id: str | None = None,
    provider_order_id: str | None = None,
    provider_payment_id: str | None = None,
    provider_subscription_id: str | None = None,
    amount_cents: int,
    currency: str,
    status: str,
    metadata: CreditMetadata | None = None,
) -> str | None:
    res = await session.execute(
        pg_insert(PaymentRecord)
        .values(
            user_id=user_id,
            provider=provider,
            kind=kind,
            product_key=product_key,
            provider_customer_id=provider_customer_id,
            provider_order_id=provider_order_id,
            provider_payment_id=provider_payment_id,
            provider_subscription_id=provider_subscription_id,
            amount_cents=amount_cents,
            currency=currency,
            status=status,
            metadata_=metadata,
        )
        .on_conflict_do_nothing()
        .returning(PaymentRecord.id)
    )
    return res.scalar_one_or_none()


async def grant_credits(
    session: AsyncSession,
    *,
    user_id: str,
    amount: int,
    source: CreditGrantSource,
    source_id: str,
    idempotency_key: str,
    payment_id: str | None = None,
    expires_at: datetime | None = None,
    reason: str | None = None,
    metadata: CreditMetadata | None = None,
) -> GrantResult:
    if amount <= 0:
        raise ValueError("credit grant amount must be positive")
    expires_at = _utc_naive(expires_at)

    existing = await transaction_by_key(session, idempotency_key)
    if existing:
        return GrantResult(granted=False, balance=existing.balance_after)

    await ensure_credit_account(session, user_id)

    grant_id = (
        await session.execute(
            pg_insert(CreditGrant)
            .values(
                user_id=user_id,
                payment_id=payment_id,
                source=source,
                source_id=source_id,
                credits_granted=amount,
                credits_remaining=amount,
                expires_at=expires_at,
                metadata_=metadata,
            )
            .on_conflict_do_nothing()
            .returning(CreditGrant.id)
        )
    ).scalar_one_or_none()

    if grant_id is None:
        account = (
            await session.execute(
                select(CreditAccount.available_credits)
                .where(CreditAccount.user_id == user_id)
                .limit(1),
            )
        ).scalar_one_or_none()
        return GrantResult(granted=False, balance=int(account or 0))

    account = (
        await session.execute(
            update(CreditAccount)
            .where(CreditAccount.user_id == user_id)
            .values(
                available_credits=CreditAccount.available_credits + amount,
                lifetime_granted=CreditAccount.lifetime_granted + amount,
                updated_at=_utc_naive(datetime.now(UTC)),
            )
            .returning(CreditAccount.available_credits)
        )
    ).scalar_one_or_none()

    balance = int(account) if account is not None else amount

    await session.execute(
        pg_insert(CreditTransaction).values(
            user_id=user_id,
            grant_id=grant_id,
            payment_id=payment_id,
            type="grant",
            amount=amount,
            balance_after=balance,
            idempotency_key=idempotency_key,
            reason=reason,
            metadata_=metadata,
        )
    )

    return GrantResult(granted=True, balance=balance)


async def debit_credits(
    session: AsyncSession,
    *,
    user_id: str,
    amount: int,
    type_: CreditDebitType,
    idempotency_key: str,
    usage_event_id: str | None = None,
    payment_id: str | None = None,
    reason: str | None = None,
    metadata: CreditMetadata | None = None,
) -> DebitResult:
    if amount <= 0:
        raise ValueError("credit debit amount must be positive")

    existing = await transaction_by_key(session, idempotency_key)
    if existing:
        return DebitResult(ok=True, charged=abs(existing.amount), balance=existing.balance_after)

    await ensure_credit_account(session, user_id)

    balance_before = int(
        (
            await session.execute(
                select(CreditAccount.available_credits)
                .where(CreditAccount.user_id == user_id)
                .limit(1),
            )
        ).scalar_one_or_none()
        or 0
    )
    if balance_before < amount:
        return DebitResult(ok=False, charged=0, balance=balance_before, insufficient=True)

    now = _utc_naive(datetime.now(UTC))
    assert now is not None
    grants = (
        await session.execute(
            select(CreditGrant.id, CreditGrant.credits_remaining)
            .where(
                and_(
                    CreditGrant.user_id == user_id,
                    CreditGrant.status == "active",
                    CreditGrant.credits_remaining > 0,
                    or_(CreditGrant.expires_at.is_(None), CreditGrant.expires_at > now),
                )
            )
            .order_by(CreditGrant.expires_at.asc().nulls_last(), CreditGrant.created_at.asc())
        )
    ).all()

    remaining = amount
    grant_breakdown: list[dict[str, object]] = []

    for grant_id, credits_remaining in grants:
        if remaining <= 0:
            break
        debit = min(remaining, int(credits_remaining))
        remaining -= debit
        grant_breakdown.append({"grantId": str(grant_id), "amount": debit})

        next_remaining = int(credits_remaining) - debit
        await session.execute(
            update(CreditGrant)
            .where(CreditGrant.id == grant_id)
            .values(
                credits_remaining=next_remaining,
                status="depleted" if next_remaining == 0 else "active",
            )
        )

    if remaining > 0:
        return DebitResult(ok=False, charged=0, balance=balance_before, insufficient=True)

    values: dict = {
        "available_credits": CreditAccount.available_credits - amount,
        "updated_at": now,
    }
    if type_ == "consume":
        values["lifetime_consumed"] = CreditAccount.lifetime_consumed + amount
    elif type_ == "refund":
        values["lifetime_refunded"] = CreditAccount.lifetime_refunded + amount

    updated_balance = (
        await session.execute(
            update(CreditAccount)
            .where(CreditAccount.user_id == user_id, CreditAccount.available_credits >= amount)
            .values(**values)
            .returning(CreditAccount.available_credits)
        )
    ).scalar_one_or_none()

    if updated_balance is None:
        return DebitResult(ok=False, charged=0, balance=balance_before, insufficient=True)

    await session.execute(
        pg_insert(CreditTransaction).values(
            user_id=user_id,
            usage_event_id=usage_event_id,
            payment_id=payment_id,
            type=type_,
            amount=-amount,
            balance_after=int(updated_balance),
            idempotency_key=idempotency_key,
            reason=reason,
            metadata_={**(metadata or {}), "grantBreakdown": grant_breakdown},
        )
    )

    return DebitResult(ok=True, charged=amount, balance=int(updated_balance))


async def consume_credits(
    session: AsyncSession,
    *,
    user_id: str,
    amount: int,
    idempotency_key: str,
    usage_event_id: str | None = None,
    reason: str | None = None,
    metadata: CreditMetadata | None = None,
) -> DebitResult:
    return await debit_credits(
        session,
        user_id=user_id,
        amount=amount,
        type_="consume",
        idempotency_key=idempotency_key,
        usage_event_id=usage_event_id,
        reason=reason,
        metadata=metadata,
    )


async def refund_credits(
    session: AsyncSession,
    *,
    user_id: str,
    amount: int,
    idempotency_key: str,
    payment_id: str | None = None,
    reason: str | None = None,
    metadata: CreditMetadata | None = None,
) -> DebitResult:
    return await debit_credits(
        session,
        user_id=user_id,
        amount=amount,
        type_="refund",
        idempotency_key=idempotency_key,
        payment_id=payment_id,
        reason=reason,
        metadata=metadata,
    )


async def expire_user_credits(
    session: AsyncSession,
    user_id: str,
    *,
    sources: list[str] | None = None,
    reason: str | None = None,
) -> int:
    stmt = select(CreditGrant.id, CreditGrant.credits_remaining).where(
        and_(
            CreditGrant.user_id == user_id,
            CreditGrant.status == "active",
            CreditGrant.credits_remaining > 0,
        )
    )
    if sources:
        stmt = stmt.where(CreditGrant.source.in_(sources))
    expired = (await session.execute(stmt)).all()

    total_expired = 0
    for grant_id, credits_remaining in expired:
        amount = int(credits_remaining)
        result = await debit_credits(
            session,
            user_id=user_id,
            amount=amount,
            type_="expire",
            idempotency_key=f"expire:upgrade:{grant_id}",
            reason=reason or "credits expired on plan upgrade",
            metadata={"grantId": str(grant_id)},
        )
        if result.ok:
            total_expired += result.charged
            await session.execute(
                update(CreditGrant)
                .where(CreditGrant.id == grant_id)
                .values(status="expired", credits_remaining=0)
            )
    return total_expired


async def expire_credits(
    session: AsyncSession, now: datetime | None = None, user_id: str | None = None
) -> int:
    now = _utc_naive(now or datetime.now(UTC))
    assert now is not None
    stmt = select(CreditGrant.id, CreditGrant.user_id, CreditGrant.credits_remaining).where(
        and_(
            CreditGrant.status == "active",
            CreditGrant.credits_remaining > 0,
            CreditGrant.expires_at.is_not(None),
            CreditGrant.expires_at <= now,
        )
    )
    if user_id:
        stmt = stmt.where(CreditGrant.user_id == user_id)
    expired = (await session.execute(stmt)).all()

    total_expired = 0
    for grant_id, grant_user_id, credits_remaining in expired:
        amount = int(credits_remaining)
        result = await debit_credits(
            session,
            user_id=grant_user_id,
            amount=amount,
            type_="expire",
            idempotency_key=f"expire:{grant_id}",
            reason="credits expired",
            metadata={"grantId": str(grant_id)},
        )
        if result.ok:
            total_expired += result.charged
            await session.execute(
                update(CreditGrant)
                .where(CreditGrant.id == grant_id)
                .values(status="expired", credits_remaining=0)
            )
    return total_expired