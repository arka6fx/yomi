"""Single credit-charging chokepoint.

Port of apps/backend/src/services/metering.ts. Credits are the only gate: an
active plan is required and the action proceeds only once the balance covers the
cost, then exactly one usage event is recorded and credits consumed.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal, TypedDict

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.db.models_app import UsageEvent
from yomi.db.models_auth import User

from .credit_ledger import consume_credits, expire_credits, get_credit_summary
from .credit_pricing import UsagePricingInput, credits_for_usage
from .entitlements import (
    effective_plan_for_user,
    get_plan_config,
    has_billable_plan_access,
)

logger = logging.getLogger(__name__)

ChargeKind = Literal["chat", "voice", "analyze", "bot_message", "agent", "composio_tool"]

CREDIT_KIND: dict[ChargeKind, str] = {
    "chat": "chat",
    "voice": "voice",
    "analyze": "analyze",
    "bot_message": "bot_message",
    "agent": "agent",
    "composio_tool": "composio_tool",
}

# What we store on usage_events.kind to match existing dashboard/queries. Only
# chat/voice/agent become request_*; the rest pass through as-is.
EVENT_KIND: dict[ChargeKind, str] = {
    "chat": "request_chat",
    "voice": "request_voice",
    "analyze": "analyze",
    "bot_message": "bot_message",
    "agent": "request_agent",
    "composio_tool": "composio_tool",
}


class MeteringUser(TypedDict, total=False):
    id: str
    email: str | None
    role: str | None
    plan: str | None
    subscription_status: str | None
    current_period_end: datetime | None
    trial_end_date: datetime | None


@dataclass
class ChargeSuccess:
    ok: Literal[True] = True
    plan: str = ""
    credits_required: int = 0
    credits_charged: int = 0
    balance: int = 0
    usage_event_id: str | None = None
    paid_by: str = "credits"


@dataclass
class ChargeFailure:
    ok: Literal[False] = False
    status: int = 402
    code: str = "subscription_inactive"
    message: str = ""
    plan: str = ""


@dataclass
class ChargeInput:
    user: MeteringUser
    kind: ChargeKind
    duration_seconds: int | None = None
    units: int | None = None
    metadata: Mapping[str, object] | None = None


def _month_day(dt: datetime) -> str:
    return dt.strftime("%B").rstrip() + " " + str(dt.day)


def next_month_reset_label() -> str:
    now = datetime.now(UTC)
    reset = (now.replace(day=28) + timedelta(days=4)).replace(day=1)
    return _month_day(reset)


def explore_renewal_label(user: MeteringUser) -> str:
    trial_end = user.get("trial_end_date")
    if not trial_end:
        return "next month"
    return _month_day(trial_end)


async def charge_usage(session: AsyncSession, input_: ChargeInput) -> ChargeSuccess | ChargeFailure:
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
        await expire_credits(session, user_id=user.get("id"))
    except Exception as exc:  # best-effort; never block charging on the sweep
        logger.error("[chargeUsage] expireCredits failed: %s %s", user.get("id"), exc)

    credits_required = credits_for_usage(
        CREDIT_KIND[kind],  # type: ignore[arg-type]
        UsagePricingInput(duration_seconds=input_.duration_seconds, units=input_.units),
    )
    summary = await get_credit_summary(session, user["id"])

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

    event_id = (
        await session.execute(
            pg_insert(UsageEvent)
            .values(
                user_id=user["id"],
                kind=EVENT_KIND[kind],
                input_tokens=0,
                output_tokens=0,
                cost_cents=input_.duration_seconds or 0,
                credits_charged=0,
                status="done",
                metadata_={**(dict(input_.metadata or {})), "reserveKind": kind},
            )
            .returning(UsageEvent.id)
        )
    ).scalar_one_or_none()

    if event_id is None:
        logger.error(
            "[metering] usage event insert returned no row user=%s kind=%s", user.get("id"), kind
        )
        return ChargeFailure(
            status=402,
            code="credits_exhausted",
            message="Couldn't record usage. Please try again.",
            plan=plan,
        )

    debit = await consume_credits(
        session,
        user_id=user["id"],
        amount=credits_required,
        usage_event_id=str(event_id),
        idempotency_key=f"usage:{event_id}:consume",
        reason=f"{kind} usage",
        metadata={**(dict(input_.metadata or {})), "kind": kind},
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

    await session.execute(
        update(UsageEvent).where(UsageEvent.id == event_id).values(credits_charged=debit.charged)
    )

    return ChargeSuccess(
        plan=plan,
        credits_required=credits_required,
        credits_charged=debit.charged,
        balance=debit.balance,
        usage_event_id=str(event_id),
        paid_by="credits",
    )


async def load_metering_user(session: AsyncSession, user_id: str) -> MeteringUser | None:
    row = (
        await session.execute(
            select(User).where(User.id == user_id).limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return MeteringUser(
        id=row.id,
        email=row.email,
        role=row.role,
        plan=row.plan,
        subscription_status=row.subscription_status,
        trial_end_date=row.trial_end_date,
        current_period_end=row.current_period_end,
    )


def low_credit_warning(user: MeteringUser, balance: int) -> str | None:
    included = get_plan_config(user)["includedCredits"]
    if included <= 0:
        return None
    if balance > included * 0.2:
        return None
    return f"You have {balance} credits left."