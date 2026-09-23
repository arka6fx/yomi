"""D1 implementation of the credit ledger, metering chokepoint, AI telemetry,
and payment-event dedup.

Mirrors ``credit_ledger.py`` / ``metering.py`` / ``ai_telemetry.py`` /
``payment_events.py`` statement-for-statement on ``D1Store``:

- IDs and timestamps are generated client-side (D1 has no pg defaults here)
- datetimes are ISO ``+00:00`` strings; comparisons stay lexicographic
- idempotency keys + unique constraints carry the same exactly-once argument
  as the Postgres version (sequential batches, reconcile-by-select)
- ``NULLS LAST`` is spelled as an explicit ``CASE`` for SQLite portability

Call-site wiring lands with the auth route group; until then the Postgres
functions remain the live path.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from yomi.services.ai_telemetry import (
    AiUsageRecord,
    sanitize_telemetry_metadata,
)
from yomi.services.ai_telemetry import (
    _clamp as _telemetry_clamp,
)
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import parse_dt, utcnow_iso
from yomi.services.credit_ledger import (
    CreditDebitType,
    CreditGrantSource,
    CreditMetadata,
    CreditSummary,
    DebitResult,
    GrantResult,
)
from yomi.services.credit_pricing import UsagePricingInput, credits_for_usage
from yomi.services.entitlements import (
    effective_plan_for_user,
    has_billable_plan_access,
)
from yomi.services.metering import (
    CREDIT_KIND,
    EVENT_KIND,
    ChargeFailure,
    ChargeInput,
    ChargeSuccess,
    MeteringUser,
    explore_renewal_label,
    next_month_reset_label,
)
from yomi.shared.ai_pricing import TokenCounts, cost_micros

logger = logging.getLogger(__name__)


@dataclass
class FoundTransaction:
    amount: int
    balance_after: int
    usage_event_id: str | None = None


def _utc_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).isoformat()


def _now() -> str:
    return utcnow_iso()


async def ensure_credit_account(backend: D1Backend, user_id: str) -> None:
    await backend.store.atomic([
        backend.store.insert_or_ignore("credit_accounts", {
            "user_id": user_id,
            "available_credits": 0,
            "lifetime_granted": 0,
            "lifetime_consumed": 0,
            "lifetime_refunded": 0,
            "updated_at": _now(),
        })
    ])


async def transaction_by_key(
    backend: D1Backend, idempotency_key: str
) -> FoundTransaction | None:
    row = await backend.store.fetch_one(
        "SELECT amount, balance_after, usage_event_id FROM credit_transactions "
        "WHERE idempotency_key = ? LIMIT 1",
        [idempotency_key],
    )
    if row is None:
        return None
    return FoundTransaction(
        amount=int(row["amount"]),
        balance_after=int(row["balance_after"]),
        usage_event_id=str(row["usage_event_id"]) if row.get("usage_event_id") else None,
    )


async def get_credit_summary(backend: D1Backend, user_id: str) -> CreditSummary:
    await ensure_credit_account(backend, user_id)
    account = await backend.store.fetch_one(
        "SELECT * FROM credit_accounts WHERE user_id = ? LIMIT 1", [user_id]
    )
    now = _now()
    soon = (datetime.now(UTC) + timedelta(days=7)).isoformat()
    expiring = await backend.store.fetch_one(
        "SELECT COALESCE(SUM(credits_remaining), 0) AS total, MIN(expires_at) AS soonest "
        "FROM credit_grants WHERE user_id = ? AND status = 'active' "
        "AND credits_remaining > 0 AND expires_at > ? AND expires_at <= ?",
        [user_id, now, soon],
    )
    return CreditSummary(
        balance=int(account["available_credits"]) if account else 0,
        lifetime_granted=int(account["lifetime_granted"]) if account else 0,
        lifetime_consumed=int(account["lifetime_consumed"]) if account else 0,
        lifetime_refunded=int(account["lifetime_refunded"]) if account else 0,
        expiring_soon=int((expiring or {}).get("total") or 0),
        expiring_soon_at=parse_dt((expiring or {}).get("soonest")),
    )


async def recent_credit_transactions(
    backend: D1Backend, user_id: str, limit: int = 20
) -> list[dict]:
    rows = await backend.store.fetch_all(
        "SELECT t.id AS id, t.type AS type, t.amount AS amount, "
        "t.balance_after AS balance_after, t.reason AS reason, "
        "t.usage_event_id AS usage_event_id, u.kind AS usage_kind, "
        "u.credits_charged AS usage_credits_charged, u.created_at AS usage_created_at, "
        "t.created_at AS created_at "
        "FROM credit_transactions t LEFT JOIN usage_events u ON u.id = t.usage_event_id "
        "WHERE t.user_id = ? ORDER BY t.created_at DESC LIMIT ?",
        [user_id, limit],
    )
    return [dict(row) for row in rows]


async def create_payment_record(
    backend: D1Backend,
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
    record_id = str(uuid.uuid4())
    await backend.store.atomic([
        backend.store.insert_or_ignore("payment_records", {
            "id": record_id,
            "user_id": user_id,
            "provider": provider,
            "kind": kind,
            "product_key": product_key,
            "provider_customer_id": provider_customer_id,
            "provider_order_id": provider_order_id,
            "provider_payment_id": provider_payment_id,
            "provider_subscription_id": provider_subscription_id,
            "amount_cents": amount_cents,
            "currency": currency,
            "status": status,
            "metadata": metadata,
            "created_at": _now(),
            "updated_at": _now(),
        })
    ])
    row = await backend.store.fetch_one(
        "SELECT id FROM payment_records WHERE id = ? LIMIT 1", [record_id]
    )
    return str(row["id"]) if row else None


async def grant_credits(
    backend: D1Backend,
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

    existing = await transaction_by_key(backend, idempotency_key)
    if existing:
        return GrantResult(granted=False, balance=existing.balance_after)

    await ensure_credit_account(backend, user_id)
    now = _now()
    await backend.store.atomic([
        backend.store.insert_or_ignore("credit_grants", {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "payment_id": payment_id,
            "source": source,
            "source_id": source_id,
            "credits_granted": amount,
            "credits_remaining": amount,
            "expires_at": _utc_iso(expires_at),
            "status": "active",
            "metadata": metadata,
            "created_at": now,
        })
    ])
    grant = await backend.store.fetch_one(
        "SELECT id FROM credit_grants WHERE source = ? AND source_id = ? LIMIT 1",
        [source, source_id],
    )
    if grant is None:  # pragma: no cover — defensive; unique key guarantees a row
        account = await backend.store.fetch_one(
            "SELECT available_credits FROM credit_accounts WHERE user_id = ? LIMIT 1",
            [user_id],
        )
        balance = int((account or {}).get("available_credits") or 0)
        return GrantResult(granted=False, balance=balance)

    updated = await backend.store.atomic([
        Statement(
            "UPDATE credit_accounts SET available_credits = available_credits + ?, "
            "lifetime_granted = lifetime_granted + ?, updated_at = ? "
            "WHERE user_id = ? RETURNING available_credits",
            [amount, amount, now, user_id],
        )
    ])
    returned = (updated[0].get("results") or [{}])[0]
    balance = int(returned.get("available_credits") or amount)

    await backend.store.atomic([
        backend.store.insert("credit_transactions", {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "grant_id": str(grant["id"]),
            "usage_event_id": None,
            "payment_id": payment_id,
            "type": "grant",
            "amount": amount,
            "balance_after": balance,
            "idempotency_key": idempotency_key,
            "reason": reason,
            "metadata": metadata,
            "created_at": _now(),
        })
    ])
    return GrantResult(granted=True, balance=balance)


async def debit_credits(
    backend: D1Backend,
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

    existing = await transaction_by_key(backend, idempotency_key)
    if existing:
        return DebitResult(ok=True, charged=abs(existing.amount), balance=existing.balance_after)

    await ensure_credit_account(backend, user_id)
    account = await backend.store.fetch_one(
        "SELECT available_credits FROM credit_accounts WHERE user_id = ? LIMIT 1", [user_id]
    )
    balance_before = int((account or {}).get("available_credits") or 0)
    if balance_before < amount:
        return DebitResult(ok=False, charged=0, balance=balance_before, insufficient=True)

    now = _now()
    grants = await backend.store.fetch_all(
        "SELECT id, credits_remaining FROM credit_grants "
        "WHERE user_id = ? AND status = 'active' AND credits_remaining > 0 "
        "AND (expires_at IS NULL OR expires_at > ?) "
        "ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, "
        "created_at ASC",
        [user_id, now],
    )

    remaining = amount
    grant_breakdown: list[dict[str, object]] = []
    for grant in grants:
        if remaining <= 0:
            break
        left = int(grant["credits_remaining"])
        debit = min(remaining, left)
        remaining -= debit
        grant_breakdown.append({"grantId": str(grant["id"]), "amount": debit})
        await backend.store.atomic([
            Statement(
                "UPDATE credit_grants SET credits_remaining = ?, status = ? WHERE id = ?",
                [left - debit, "depleted" if left - debit == 0 else "active", grant["id"]],
            )
        ])
    if remaining > 0:
        return DebitResult(ok=False, charged=0, balance=balance_before, insufficient=True)

    if type_ == "consume":
        set_clause = (
            "available_credits = available_credits - ?, "
            "lifetime_consumed = lifetime_consumed + ?, updated_at = ?"
        )
        set_params: list[Any] = [amount, amount, now]
    elif type_ == "refund":
        set_clause = (
            "available_credits = available_credits - ?, "
            "lifetime_refunded = lifetime_refunded + ?, updated_at = ?"
        )
        set_params = [amount, amount, now]
    else:
        set_clause = "available_credits = available_credits - ?, updated_at = ?"
        set_params = [amount, now]
    updated = await backend.store.atomic([
        Statement(
            "UPDATE credit_accounts SET " + set_clause + " "
            "WHERE user_id = ? AND available_credits >= ? RETURNING available_credits",
            [*set_params, user_id, amount],
        )
    ])
    returned = (updated[0].get("results") or [None])[0]
    if returned is None:
        return DebitResult(ok=False, charged=0, balance=balance_before, insufficient=True)

    await backend.store.atomic([
        backend.store.insert("credit_transactions", {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "grant_id": None,
            "usage_event_id": usage_event_id,
            "payment_id": payment_id,
            "type": type_,
            "amount": -amount,
            "balance_after": int(returned["available_credits"]),
            "idempotency_key": idempotency_key,
            "reason": reason,
            "metadata": {**(metadata or {}), "grantBreakdown": grant_breakdown},
            "created_at": _now(),
        })
    ])
    return DebitResult(ok=True, charged=amount, balance=int(returned["available_credits"]))


async def consume_credits(
    backend: D1Backend,
    *,
    user_id: str,
    amount: int,
    idempotency_key: str,
    usage_event_id: str | None = None,
    reason: str | None = None,
    metadata: CreditMetadata | None = None,
) -> DebitResult:
    return await debit_credits(
        backend, user_id=user_id, amount=amount, type_="consume",
        idempotency_key=idempotency_key, usage_event_id=usage_event_id,
        reason=reason, metadata=metadata,
    )


async def refund_credits(
    backend: D1Backend,
    *,
    user_id: str,
    amount: int,
    idempotency_key: str,
    payment_id: str | None = None,
    reason: str | None = None,
    metadata: CreditMetadata | None = None,
) -> DebitResult:
    return await debit_credits(
        backend, user_id=user_id, amount=amount, type_="refund",
        idempotency_key=idempotency_key, payment_id=payment_id,
        reason=reason, metadata=metadata,
    )


async def expire_user_credits(
    backend: D1Backend,
    user_id: str,
    *,
    sources: list[str] | None = None,
    reason: str | None = None,
) -> int:
    params: list[Any] = [user_id]
    source_filter = ""
    if sources:
        placeholders = ", ".join("?" for _ in sources)
        source_filter = f" AND source IN ({placeholders})"
        params.extend(sources)
    expired = await backend.store.fetch_all(
        "SELECT id, credits_remaining FROM credit_grants "
        "WHERE user_id = ? AND status = 'active' AND credits_remaining > 0" + source_filter,
        params,
    )
    total_expired = 0
    for grant in expired:
        result = await debit_credits(
            backend, user_id=user_id, amount=int(grant["credits_remaining"]),
            type_="expire", idempotency_key=f"expire:upgrade:{grant['id']}",
            reason=reason or "credits expired on plan upgrade",
            metadata={"grantId": str(grant["id"])},
        )
        if result.ok:
            total_expired += result.charged
            await backend.store.atomic([
                Statement(
                    "UPDATE credit_grants SET status = 'expired', credits_remaining = 0 "
                    "WHERE id = ?",
                    [grant["id"]],
                )
            ])
    return total_expired


async def expire_credits(
    backend: D1Backend, now: datetime | None = None, user_id: str | None = None
) -> int:
    current = _utc_iso(now or datetime.now(UTC))
    params: list[Any] = []
    user_filter = ""
    if user_id:
        user_filter = " AND user_id = ?"
        params.append(user_id)
    expired = await backend.store.fetch_all(
        "SELECT id, user_id, credits_remaining FROM credit_grants "
        "WHERE status = 'active' AND credits_remaining > 0 "
        "AND expires_at IS NOT NULL AND expires_at <= ?" + user_filter,
        [current, *params],
    )
    total_expired = 0
    for grant in expired:
        result = await debit_credits(
            backend, user_id=str(grant["user_id"]), amount=int(grant["credits_remaining"]),
            type_="expire", idempotency_key=f"expire:{grant['id']}",
            reason="credits expired", metadata={"grantId": str(grant["id"])},
        )
        if result.ok:
            total_expired += result.charged
            await backend.store.atomic([
                Statement(
                    "UPDATE credit_grants SET status = 'expired', credits_remaining = 0 "
                    "WHERE id = ?",
                    [grant["id"]],
                )
            ])
    return total_expired


async def charge_usage(
    backend: D1Backend, input_: ChargeInput, idempotency_key: str | None = None
) -> ChargeSuccess | ChargeFailure:
    """D1 counterpart of the metering chokepoint: identical gating, messages,
    and debit semantics.

    With ``idempotency_key`` the charge becomes replay-safe: a prior
    transaction under the same key returns its recorded outcome without
    touching the balance again. Executors pass one key per run so crash
    retries never double-charge.
    """
    user = input_.user
    kind = input_.kind
    plan = effective_plan_for_user(user)

    if not has_billable_plan_access(user):
        status = user.get("subscription_status") or "inactive"
        if status == "past_due":
            message = (
                "Payment didn't go through — Yomi is paused. Update your payment method "
                "in the dashboard."
            )
        elif status == "inactive" and plan == "explore":
            message = (
                "Your free credits are renewing — try again in a moment, or upgrade to "
                "Pro or Max to skip the wait."
            )
        else:
            message = "Subscription isn't active. Head to the dashboard to sort it out."
        return ChargeFailure(status=402, code="subscription_inactive", message=message, plan=plan)

    try:
        await expire_credits(backend, user_id=user.get("id"))
    except Exception as exc:  # best-effort; never block charging on the sweep
        logger.error("[chargeUsage] expireCredits failed: %s %s", user.get("id"), exc)

    credits_required = credits_for_usage(
        CREDIT_KIND[kind],
        UsagePricingInput(duration_seconds=input_.duration_seconds, units=input_.units),
    )
    if idempotency_key is not None:
        replay = await transaction_by_key(backend, idempotency_key)
        if replay is not None:
            return ChargeSuccess(
                plan=plan,
                credits_required=credits_required,
                credits_charged=abs(replay.amount),
                balance=replay.balance_after,
                usage_event_id=replay.usage_event_id,
                paid_by="credits",
            )
    summary = await get_credit_summary(backend, user["id"])
    if summary.balance < credits_required:
        if plan == "explore":
            return ChargeFailure(
                ok=False,
                status=402,
                code="subscription_required",
                message=(
                    f"You're out of free credits for this month. They renew "
                    f"{explore_renewal_label(user)}, or upgrade to Pro or Max for more right now."
                ),
                plan=plan,
            )
        return ChargeFailure(
            ok=False,
            status=402,
            code="credits_exhausted",
            message=(
                f"You're out of credits. Buy a credit pack to continue. Resets "
                f"{next_month_reset_label()}."
            ),
            plan=plan,
        )

    event_id = str(uuid.uuid4())
    await backend.store.atomic([
        backend.store.insert("usage_events", {
            "id": event_id,
            "user_id": user["id"],
            "device_id": None,
            "kind": EVENT_KIND[kind],
            "model": None,
            "input_tokens": 0,
            "output_tokens": 0,
            "cost_cents": input_.duration_seconds or 0,
            "credits_charged": 0,
            "status": "done",
            "metadata": {**(dict(input_.metadata or {})), "reserveKind": kind},
            "created_at": _now(),
        })
    ])

    debit = await consume_credits(
        backend, user_id=user["id"], amount=credits_required,
        usage_event_id=event_id, idempotency_key=idempotency_key or f"usage:{event_id}:consume",
        reason=f"{kind} usage", metadata={**(dict(input_.metadata or {})), "kind": kind},
    )
    if not debit.ok:
        code = "subscription_required" if plan == "explore" else "credits_exhausted"
        if plan == "explore":
            message = (
                f"You're out of free credits for this month. They renew "
                f"{explore_renewal_label(user)}, or upgrade to Pro or Max for more right now."
            )
        else:
            message = (
                f"You're out of credits. Buy a credit pack to continue. Resets "
                f"{next_month_reset_label()}."
            )
        return ChargeFailure(status=402, code=code, message=message, plan=plan)

    await backend.store.atomic([
        Statement(
            "UPDATE usage_events SET credits_charged = ? WHERE id = ?",
            [debit.charged, event_id],
        )
    ])
    return ChargeSuccess(
        plan=plan,
        credits_required=credits_required,
        credits_charged=debit.charged,
        balance=debit.balance,
        usage_event_id=event_id,
        paid_by="credits",
    )


async def load_metering_user(backend: D1Backend, user_id: str) -> MeteringUser | None:
    row = await backend.store.fetch_one(
        "SELECT * FROM user WHERE id = ? LIMIT 1", [user_id]
    )
    if row is None:
        return None
    return MeteringUser(
        id=str(row["id"]),
        email=row.get("email"),
        role=row.get("role"),
        plan=row.get("plan"),
        subscription_status=row.get("subscription_status"),
        trial_end_date=parse_dt(row.get("trial_end_date")),
        current_period_end=parse_dt(row.get("current_period_end")),
    )


async def record_ai_usage(backend: D1Backend, input_: AiUsageRecord) -> None:
    """Best-effort telemetry insert; never raises into the request path."""
    total_cost = input_.total_api_cost_micros or 0
    if total_cost <= 0:
        total_cost = cost_micros(
            input_.model,
            TokenCounts(
                input_tokens=input_.input_tokens or 0,
                output_tokens=input_.output_tokens or 0,
                cached_input_tokens=input_.cached_input_tokens or 0,
            ),
        )
    try:
        await backend.store.atomic([
            backend.store.insert_or_ignore("ai_usage_events", {
                "id": str(uuid.uuid4()),
                "usage_event_id": input_.usage_event_id,
                "user_id": input_.user_id,
                "request_id": input_.request_id,
                "endpoint": input_.endpoint,
                "surface": input_.surface,
                "route": input_.route,
                "intent": input_.intent,
                "complexity": input_.complexity,
                "model": input_.model,
                "provider": input_.provider or "workers-ai",
                "input_tokens": _telemetry_clamp(input_.input_tokens),
                "output_tokens": _telemetry_clamp(input_.output_tokens),
                "reasoning_tokens": _telemetry_clamp(input_.reasoning_tokens),
                "cached_input_tokens": _telemetry_clamp(input_.cached_input_tokens),
                "embedding_tokens": _telemetry_clamp(input_.embedding_tokens),
                "max_output_tokens": _telemetry_clamp(input_.max_output_tokens),
                "tool_calls": _telemetry_clamp(input_.tool_calls),
                "connector_count": len(input_.connector_ids or []),
                "connector_ids": input_.connector_ids or [],
                "vision_images": _telemetry_clamp(input_.vision_images),
                "voice_duration_seconds": _telemetry_clamp(input_.voice_duration_seconds),
                "tts_chars": _telemetry_clamp(input_.tts_chars),
                "stt_audio_seconds": _telemetry_clamp(input_.stt_audio_seconds),
                "latency_ms": _telemetry_clamp(input_.latency_ms),
                "first_token_latency_ms": (
                    max(0, int(input_.first_token_latency_ms))
                    if input_.first_token_latency_ms is not None
                    else None
                ),
                "total_api_cost_micros": _telemetry_clamp(total_cost),
                "credits_estimated": _telemetry_clamp(input_.credits_estimated),
                "credits_charged": _telemetry_clamp(input_.credits_charged),
                "status": input_.status,
                "error_code": input_.error_code,
                "metadata": sanitize_telemetry_metadata(input_.metadata),
                "completed_at": _now(),
                "created_at": _now(),
            })
        ])
    except Exception as exc:  # noqa: BLE001 — best-effort, mirrors Postgres path
        logger.warning("[ai-telemetry] recordAiUsage failed: %s", exc)


async def record_payment_event(
    backend: D1Backend,
    *,
    provider: str,
    event_id: str,
    event_type: str,
    payload_hash_value: str,
) -> dict[str, bool]:
    record_id = str(uuid.uuid4())
    await backend.store.atomic([
        backend.store.insert_or_ignore("processed_payment_events", {
            "id": record_id,
            "provider": provider,
            "event_id": event_id,
            "event_type": event_type,
            "payload_hash": payload_hash_value,
            "received_at": _now(),
        })
    ])
    row = await backend.store.fetch_one(
        "SELECT id FROM processed_payment_events WHERE id = ? LIMIT 1", [record_id]
    )
    return {"duplicate": row is None}


async def upsert_payment_record(
    backend: D1Backend,
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
        existing = await backend.store.fetch_one(
            "SELECT id FROM payment_records WHERE provider = ? AND provider_order_id = ? "
            "LIMIT 1",
            [provider, provider_order_id],
        )
        if existing is not None:
            await backend.store.atomic([
                Statement(
                    "UPDATE payment_records SET status = ?, provider_payment_id = ?, "
                    "provider_customer_id = ?, provider_subscription_id = ?, "
                    "amount_cents = ?, currency = ?, metadata = ?, updated_at = ? "
                    "WHERE id = ?",
                    [status, provider_payment_id, provider_customer_id,
                     provider_subscription_id, amount_cents, currency, metadata,
                     _now(), existing["id"]],
                )
            ])
            return str(existing["id"])
    return await create_payment_record(
        backend, user_id=user_id, provider=provider, kind=kind, product_key=product_key,
        provider_customer_id=provider_customer_id, provider_order_id=provider_order_id,
        provider_payment_id=provider_payment_id,
        provider_subscription_id=provider_subscription_id, amount_cents=amount_cents,
        currency=currency, status=status, metadata=metadata,
    )
