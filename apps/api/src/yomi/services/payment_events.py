"""Payment event dedup + payment record upserts.

Port of apps/api/src/services/payment-events.ts.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.db.models_app import PaymentRecord, ProcessedPaymentEvent

CreditMetadata = dict[str, object] | None


def payload_hash(payload: str) -> str:
    return hashlib.sha256(payload.encode()).hexdigest()


async def record_payment_event(
    session: AsyncSession,
    *,
    provider: str,
    event_id: str,
    event_type: str,
    payload_hash_value: str,
) -> dict[str, bool]:
    inserted = (
        await session.execute(
            pg_insert(ProcessedPaymentEvent)
            .values(
                provider=provider,
                event_id=event_id,
                event_type=event_type,
                payload_hash=payload_hash_value,
            )
            .on_conflict_do_nothing()
            .returning(ProcessedPaymentEvent.id)
        )
    ).scalar_one_or_none()
    return {"duplicate": inserted is None}


async def upsert_payment_record(
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
    metadata: CreditMetadata = None,
) -> str | None:
    if provider_order_id:
        existing = (
            await session.execute(
                select(PaymentRecord.id).where(
                    PaymentRecord.provider == provider,
                    PaymentRecord.provider_order_id == provider_order_id,
                ).limit(1)
            )
        ).scalar_one_or_none()

        if existing is not None:
            await session.execute(
                update(PaymentRecord)
                .where(PaymentRecord.id == existing)
                .values(
                    status=status,
                    provider_payment_id=provider_payment_id,
                    provider_customer_id=provider_customer_id,
                    provider_subscription_id=provider_subscription_id,
                    amount_cents=amount_cents,
                    currency=currency,
                    metadata_=metadata,
                    updated_at=datetime.now(UTC),
                )
            )
            return str(existing)

    inserted = (
        await session.execute(
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
                metadata=metadata,
            )
            .on_conflict_do_nothing()
            .returning(PaymentRecord.id)
        )
    ).scalar_one_or_none()
    return str(inserted) if inserted is not None else None