"""Usage metering endpoints — the single charge chokepoint.

Port of apps/api/src/routes/usage.ts.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.db.models_app import UsageEvent
from yomi.db.models_auth import User
from yomi.services import billing_d1
from yomi.services.ai_telemetry import AiUsageRecord, record_ai_usage
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend
from yomi.services.cloudflare_storage.store import utcnow_iso
from yomi.services.entitlements import credit_renewal
from yomi.services.metering import (
    ChargeInput,
    ChargeKind,
    MeteringUser,
    charge_usage,
    low_credit_warning,
)

logger = logging.getLogger(__name__)

usage_router = APIRouter(prefix="/api/usage")

VALID_KINDS: list[ChargeKind] = ["chat", "voice", "analyze", "bot_message", "agent"]


def _metering_user(user: User) -> MeteringUser:
    return MeteringUser(
        id=user.id,
        email=user.email,
        role=user.role,
        plan=user.plan,
        subscription_status=user.subscription_status,
        current_period_end=user.current_period_end,
        trial_end_date=user.trial_end_date,
    )


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


class ReserveBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kind: str
    duration: int | None = None  # voice duration in seconds


class FinalizeTelemetryBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    request_id: str | None = None
    endpoint: str | None = None
    surface: str | None = None
    route: str | None = None
    intent: str | None = None
    first_token_latency_ms: int | None = None
    latency_ms: int | None = None
    tool_calls: int | None = None
    connector_ids: list[str] | None = None
    vision_images: int | None = None
    tts_chars: int | None = None
    stt_audio_seconds: int | None = None
    max_output_tokens: int | None = None


class FinalizeBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    usage_event_id: str | None = None
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_cents: int | None = None
    status: str | None = None
    metadata: dict | None = None
    telemetry: FinalizeTelemetryBody | None = None


class UsageEventBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kind: str
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_cents: int | None = None
    device_id: str | None = None
    metadata: dict | None = None


@usage_router.post("/interactions/reserve")
async def reserve(
    body: ReserveBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    d1: D1Backend | None = Depends(get_d1_backend),
) -> Any:
    kind = body.kind
    if kind not in VALID_KINDS:
        return JSONResponse(
            {
                "error": f"kind must be one of: {', '.join(VALID_KINDS)}",
                "code": "invalid_usage_kind",
            },
            status_code=400,
        )

    charge = ChargeInput(
        user=_metering_user(user),
        kind=kind,
        duration_seconds=body.duration,
    )
    if d1 is not None:
        result = await billing_d1.charge_usage(d1, charge)
    else:
        result = await charge_usage(session, charge)

    if not result.ok:
        renewal = credit_renewal(_metering_user(user))[1]
        return JSONResponse(
            {
                "error": result.message,
                "code": result.code,
                "plan": result.plan,
                "upgradeUrl": (
                    "/dashboard?upgrade=true"
                    if result.code in ("subscription_required", "subscription_inactive")
                    else "/dashboard?credits=true"
                ),
                "resetAt": _iso(renewal),
            },
            status_code=result.status,
        )

    resp: dict[str, Any] = {
        "ok": True,
        "plan": result.plan,
        "creditsRequired": result.credits_required,
        "creditsCharged": result.credits_charged,
        "creditsRemaining": result.balance,
        "paidBy": result.paid_by,
        "resetAt": _iso(credit_renewal(_metering_user(user))[1]),
        "usageEventId": result.usage_event_id,
    }

    if user.subscription_status == "past_due":
        resp["billingWarning"] = "Your payment is past due. Please update your payment method."

    warning = (
        low_credit_warning(_metering_user(user), result.balance)
        if result.paid_by == "credits"
        else None
    )
    if warning:
        resp["usageWarning"] = warning

    return resp


@usage_router.post("/interactions/finalize")
async def finalize(
    body: FinalizeBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    d1: D1Backend | None = Depends(get_d1_backend),
) -> Any:
    usage_event_id = body.usage_event_id
    if not usage_event_id:
        return JSONResponse(
            {"error": "usageEventId is required", "code": "invalid_usage_event"},
            status_code=400,
        )

    input_tokens = max(0, int(body.input_tokens or 0))
    output_tokens = max(0, int(body.output_tokens or 0))
    cost_cents = max(0, int(body.cost_cents or 0))

    if d1 is not None:
        await d1.store.atomic([
            Statement(
                "UPDATE usage_events SET model = ?, input_tokens = ?, output_tokens = ?, "
                "cost_cents = ?, status = ?, metadata = ? "
                "WHERE id = ? AND user_id = ?",
                [body.model, input_tokens, output_tokens, cost_cents,
                 body.status or "done", body.metadata, usage_event_id, user.id],
            )
        ])
    else:
        await session.execute(
            update(UsageEvent)
            .where(UsageEvent.id == usage_event_id, UsageEvent.user_id == user.id)
            .values(
                model=body.model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost_cents=cost_cents,
                status=body.status or "done",
                metadata=body.metadata,
            )
        )

    t = body.telemetry
    if t and t.request_id and t.endpoint and t.surface:
        record = AiUsageRecord(
            user_id=user.id,
            request_id=t.request_id,
            usage_event_id=usage_event_id,
            endpoint=t.endpoint,
            surface=t.surface,
            route=t.route,
            intent=t.intent,
            model=body.model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_api_cost_micros=cost_cents * 10_000,
            tool_calls=t.tool_calls,
            connector_ids=t.connector_ids,
            vision_images=t.vision_images,
            tts_chars=t.tts_chars,
            stt_audio_seconds=t.stt_audio_seconds,
            max_output_tokens=t.max_output_tokens,
            latency_ms=t.latency_ms,
            first_token_latency_ms=t.first_token_latency_ms,
            status=(
                "error"
                if body.status == "error"
                else "cancelled"
                if body.status == "cancelled"
                else "done"
            ),
            metadata=body.metadata,
        )
        if d1 is not None:
            await billing_d1.record_ai_usage(d1, record)
        else:
            await record_ai_usage(session, record)
    return {"ok": True}


@usage_router.post("")
@usage_router.post("/")
async def report_usage(
    body: UsageEventBody,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    d1: D1Backend | None = Depends(get_d1_backend),
) -> Any:
    if d1 is not None:
        await d1.store.atomic([
            d1.store.insert("usage_events", {
                "id": str(uuid.uuid4()),
                "user_id": user.id,
                "device_id": body.device_id,
                "kind": body.kind,
                "model": body.model,
                "input_tokens": body.input_tokens or 0,
                "output_tokens": body.output_tokens or 0,
                "cost_cents": body.cost_cents or 0,
                "credits_charged": 0,
                "status": "done",
                "metadata": None,
                "created_at": utcnow_iso(),
            })
        ])
        return {"ok": True}
    await session.execute(
        pg_insert(UsageEvent).values(
            user_id=user.id,
            device_id=body.device_id,
            kind=body.kind,
            model=body.model,
            input_tokens=body.input_tokens or 0,
            output_tokens=body.output_tokens or 0,
            cost_cents=body.cost_cents or 0,
            status="done",
        )
    )
    return {"ok": True}