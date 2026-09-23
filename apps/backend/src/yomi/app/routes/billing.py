"""/api/billing — Dodo Payments checkout/webhook surface.

Port of apps/backend/src/routes/billing.ts. Dodo API calls go to
test/live.dodopayments.com per DODO_ENV; config envs mirror the TS read pattern
(DODO_TEST_API_KEY, DODO_LIVE_PRODUCT_PRO, ...).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, TypedDict
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.conf import settings
from yomi.db.models_app import PaymentRecord, UsageEvent
from yomi.db.models_auth import User
from yomi.services import billing_d1
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend
from yomi.services.cloudflare_storage.store import parse_dt as _parse_dt
from yomi.services.cloudflare_storage.store import utcnow_iso
from yomi.services.credit_ledger import (
    create_payment_record,
    expire_user_credits,
    get_credit_summary,
    grant_credits,
    recent_credit_transactions,
)
from yomi.services.entitlements import (
    credit_renewal,
    effective_plan_for_user,
    effective_role_for_user,
)
from yomi.services.payment_events import (
    payload_hash,
    record_payment_event,
    upsert_payment_record,
)
from yomi.shared.plans import CREDIT_PACKS, PLANS, get_credit_pack, get_plan

logger = logging.getLogger(__name__)

billing_router = APIRouter(prefix="/api/billing")

DodoMode = Literal["test", "live"]


def dodo_mode() -> DodoMode:
    raw = os.environ.get("DODO_ENV", "") or settings.dodo_env
    mode = raw.lower()
    if mode == "live":
        return "live"
    if raw and mode != "test":
        logger.warning("[yomi/dodo] WARNING: DODO_ENV=%s is invalid; defaulting to test", raw)
    return "test"


class DodoConfig(TypedDict):
    mode: DodoMode
    api_base: str
    api_key: str | None
    webhook_secret: str | None
    product_ids: dict[str, str | None]


def get_dodo_config() -> DodoConfig:
    mode = dodo_mode()
    prefix = "DODO_LIVE" if mode == "live" else "DODO_TEST"

    def read(key: str) -> str | None:
        selected = os.environ.get(f"{prefix}_{key}")
        if selected is not None:
            return selected or None
        legacy = os.environ.get(f"DODO_{key}")
        if legacy is not None:
            return legacy or None
        return None

    return {
        "mode": mode,
        "api_base": read("API_BASE")
        or (
            "https://live.dodopayments.com"
            if mode == "live"
            else "https://test.dodopayments.com"
        ),
        "api_key": read("API_KEY"),
        "webhook_secret": read("WEBHOOK_SECRET"),
        "product_ids": {
            "explore": None,
            "pro": read("PRODUCT_PRO"),
            "max": read("PRODUCT_MAX"),
            "credits_500": read("PRODUCT_CREDITS_85"),
            "credits_2000": read("PRODUCT_CREDITS_250"),
            "credits_6000": read("PRODUCT_CREDITS_750"),
        },
    }


DodoEntity = dict[str, Any]


def plan_features(key: str) -> list[str]:
    plan = PLANS.get(key)
    if not plan:
        return []
    return [
        f"{plan['includedCredits']:,} trial credits"
        if key == "explore"
        else f"{plan['includedCredits']:,} credits / month",
        "Screen-aware AI and voice",
        "Unlimited app connectors",
        "Telegram assistant",
        "30-day free trial" if key == "explore" else "Credit packs available",
    ]


class CurrencyDisplay(TypedDict):
    code: str
    symbol: str
    rate: float
    decimals: int


CURRENCIES: dict[str, CurrencyDisplay] = {
    "usd": {"code": "USD", "symbol": "$", "rate": 1, "decimals": 2},
    "inr": {"code": "INR", "symbol": "₹", "rate": 83, "decimals": 0},
    "eur": {"code": "EUR", "symbol": "€", "rate": 0.92, "decimals": 2},
    "gbp": {"code": "GBP", "symbol": "£", "rate": 0.79, "decimals": 2},
    "aud": {"code": "AUD", "symbol": "A$", "rate": 1.52, "decimals": 2},
    "cad": {"code": "CAD", "symbol": "C$", "rate": 1.36, "decimals": 2},
    "brl": {"code": "BRL", "symbol": "R$", "rate": 5.05, "decimals": 2},
    "jpy": {"code": "JPY", "symbol": "¥", "rate": 149, "decimals": 0},
}

COUNTRY_CURRENCY: dict[str, str] = {
    "IN": "inr",
    "US": "usd",
    "GB": "gbp",
    "CA": "cad",
    "AU": "aud",
    "BR": "brl",
    "JP": "jpy",
    "DE": "eur",
    "FR": "eur",
    "IT": "eur",
    "ES": "eur",
    "NL": "eur",
    "SE": "eur",
    "MX": "usd",
    "PH": "usd",
    "NG": "usd",
    "ZA": "usd",
    "AE": "usd",
    "SG": "usd",
    "HK": "usd",
}


def detect_currency(country: str | None) -> CurrencyDisplay:
    key = COUNTRY_CURRENCY.get(country.upper(), "usd") if country else "usd"
    return CURRENCIES.get(key, CURRENCIES["usd"])  # type: ignore[return-value]


def estimate_local(amount_cents: int, display: CurrencyDisplay) -> dict[str, object]:
    if display["code"] == "USD":
        return {"amount": amount_cents / 100, "formatted": f"${amount_cents / 100:.2f}"}
    converted = round((amount_cents / 100) * display["rate"])
    return {
        "amount": converted,
        "formatted": f"{display['symbol']}{converted:,.{display['decimals']}f}",
    }


def dodo_auth() -> str:
    config = get_dodo_config()
    api_key = config["api_key"]
    if not api_key:
        raise RuntimeError(
            f"DODO_{config['mode'].upper()}_API_KEY is not configured for "
            f"{config['mode']} mode"
        )
    return f"Bearer {api_key}"


async def dodo_request(path: str, body: Any = None, method: str | None = None) -> Any:
    config = get_dodo_config()
    url = config["api_base"].rstrip("/") + path
    logger.info(
        "[yomi/dodo] mode: %s apiBase: %s path: %s hasApiKey: %s",
        config["mode"],
        config["api_base"],
        path,
        bool(config["api_key"]),
    )

    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        raise RuntimeError(f"Dodo API has an invalid URL: {url} (mode={config['mode']})")

    http_method = method or ("GET" if body is None else "POST")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.request(
                http_method,
                url,
                headers={"Authorization": dodo_auth(), "Content-Type": "application/json"},
                json=body,
            )
    except httpx.HTTPError as err:
        raise RuntimeError(f"Dodo API request failed: {err}") from err

    text = res.text
    if res.status_code >= 400:
        raise RuntimeError(f"Dodo {path} -> {res.status_code}: {text}")
    try:
        return res.json()
    except ValueError as err:
        raise RuntimeError(f"Dodo {path} returned non-JSON: {text[:200]}") from err


def app_url(path_part: str) -> str:
    base = settings.web_origin or "http://localhost:3000"
    return base.rstrip("/") + path_part


def checkout_url(data: dict[str, Any]) -> str | None:
    return (
        data.get("checkout_url")
        or data.get("payment_link")
        or data.get("url")
        or None
    )


async def create_dodo_checkout(input_: dict[str, Any]) -> dict[str, Any]:
    logger.info("[yomi/billing] creating Dodo checkout for productId: %s", input_["productId"])
    user = input_["user"]
    # Dodo validates customer fields strictly. Better Auth permits a user with
    # no display name, so do not serialise ``name: null`` into a checkout.
    customer = {"email": user["email"]}
    if isinstance(user.get("name"), str) and user["name"].strip():
        customer["name"] = user["name"].strip()
    result = await dodo_request(
        "/checkouts",
        {
            "product_cart": [{"product_id": input_["productId"], "quantity": 1}],
            "customer": customer,
            "metadata": input_["metadata"],
            "return_url": app_url("/dashboard"),
        },
    )
    if not isinstance(result, dict):
        raise RuntimeError("Dodo checkout response was not an object")
    return result


WEBHOOK_TOLERANCE_SECONDS = 300


def verify_dodo_webhook(body: str, headers) -> bool:
    config = get_dodo_config()
    secret = config["webhook_secret"]
    if not secret:
        return False

    webhook_id = headers.get("webhook-id")
    timestamp_str = headers.get("webhook-timestamp")
    signature_header = headers.get("webhook-signature")
    if not webhook_id or not timestamp_str or not signature_header:
        return False

    try:
        timestamp = float(timestamp_str)
    except ValueError:
        return False
    age = abs(datetime.now(UTC).timestamp() - timestamp)
    if age > WEBHOOK_TOLERANCE_SECONDS:
        return False

    signed_payload = f"{webhook_id}.{timestamp_str}.{body}"
    raw_secret = secret[6:] if secret.startswith("whsec_") else secret
    key = base64.b64decode(raw_secret) if secret.startswith("whsec_") else raw_secret.encode()
    expected = hmac.new(key, signed_payload.encode(), hashlib.sha256).digest()
    expected_b64 = base64.b64encode(expected).decode()

    signatures = [
        part[3:] if part.startswith("v1,") else part
        for part in signature_header.replace(",", " ").split()
    ]
    for sig in signatures:
        if not sig:
            continue
        if hmac.compare_digest(sig.encode(), expected_b64.encode()):
            return True
    return False


def event_type(event: dict[str, Any]) -> str:
    return str(event.get("type") or event.get("event") or event.get("event_type") or "unknown")


def event_data(event: dict[str, Any]) -> DodoEntity:
    data = event.get("data")
    if isinstance(data, dict):
        return data
    payload = event.get("payload")
    if isinstance(payload, dict):
        return payload
    return event


def metadata_of(entity: DodoEntity) -> dict[str, str]:
    meta = entity.get("metadata")
    if isinstance(meta, dict):
        return {str(k): str(v) for k, v in meta.items()}
    return {}


def string_field(entity: DodoEntity, keys: list[str]) -> str | None:
    for key in keys:
        value = entity.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def number_field(entity: DodoEntity, keys: list[str]) -> float:
    for key in keys:
        value = entity.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
        if isinstance(value, str) and value:
            try:
                return float(value)
            except ValueError:
                continue
    return 0


def date_field(entity: DodoEntity, keys: list[str]) -> datetime | None:
    for key in keys:
        value = entity.get(key)
        if isinstance(value, (int, float)):
            ms = value > 10_000_000_000
            return datetime.fromtimestamp(value / 1000 if ms else value, tz=UTC)
        if isinstance(value, str) and value:
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                continue
            return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    return None


def subscription_credit_expiry(period_end: datetime | None) -> datetime:
    if period_end:
        return period_end + timedelta(days=5)
    return datetime.now(UTC) + timedelta(days=35)


def activity_label(kind: str | None, reason: str | None) -> str:
    text = f"{kind or ''} {reason or ''}".lower()
    if "voice" in text:
        return "Voice assistant"
    if any(tok in text for tok in ("image", "analyze", "screen")):
        return "Screen context"
    if "telegram" in text or "bot_message" in text:
        return "Telegram assistant"
    if "github" in text:
        return "GitHub task"
    if "notion" in text:
        return "Notion search"
    if "schedule" in text:
        return "Scheduled task"
    if "memory" in text:
        return "Memory update"
    if "request_agent" in text or "agent" in text:
        return "Agent run"
    if "request_chat" in text or "chat" in text:
        return "Chat"
    return "Yomi Activity"


def category_for_activity(kind: str | None, reason: str | None) -> str:
    label = activity_label(kind, reason).lower()
    return re.sub(r"[^a-z0-9]+", "_", label).strip("_")


@billing_router.get("/plans")
async def plans(request: Request) -> dict:
    display = detect_currency(request.headers.get("cf-ipcountry"))
    estimate = (
        None
        if display["code"] == "USD"
        else (
            f"Estimated {display['code']} equivalent. Charged in USD. "
            "Your bank may convert the amount automatically."
        )
    )

    plan_list = []
    for p in PLANS.values():
        plan_list.append(
            {
                "key": p["key"],
                "name": p["name"],
                "amountCents": p["priceCents"],
                "currency": "USD",
                "interval": "month",
                "includedCredits": p["includedCredits"],
                "features": plan_features(p["key"]),
                "local": estimate_local(p["priceCents"], display) if p["priceCents"] > 0 else None,
                "notice": estimate,
            }
        )
    return {"plans": plan_list, "displayCurrency": display["code"]}


@billing_router.post("/create-subscription")
async def create_subscription(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    plan = body.get("plan") if isinstance(body, dict) else None
    config = PLANS.get(plan)
    if not config or plan == "explore":
        return JSONResponse({"error": "Invalid plan"}, 400)

    product_id = get_dodo_config()["product_ids"].get(plan)
    if not product_id:
        return JSONResponse({"error": "Dodo product not configured for this tier"}, 500)

    if (
        user.dodo_subscription_id
        and user.plan == plan
        and user.subscription_status == "active"
    ):
        return JSONResponse({"error": "You already have an active subscription for this plan"}, 409)

    is_upgrade = (
        user.plan != "explore" and user.plan != plan and bool(user.dodo_subscription_id)
    )
    meta: dict[str, str] = {"userId": user.id, "kind": "subscription", "plan": plan}
    if is_upgrade:
        meta["isUpgrade"] = "true"
        meta["previousPlan"] = user.plan or ""

    try:
        checkout = await create_dodo_checkout(
            {
                "productId": product_id,
                "user": {"id": user.id, "name": user.name, "email": user.email},
                "metadata": meta,
            }
        )
        checkout_id = str(
            checkout.get("session_id") or checkout.get("id") or checkout.get("checkout_id") or ""
        )
        url = checkout_url(checkout)
        if not url:
            raise RuntimeError("Dodo checkout response did not include a checkout URL")

        record_kwargs = {
            "user_id": user.id,
            "provider": "dodo",
            "kind": "subscription",
            "product_key": plan,
            "provider_order_id": checkout_id or None,
            "amount_cents": config["priceCents"],
            "currency": "USD",
            "status": "created",
            "metadata": {
                "checkout": checkout,
                "isUpgrade": is_upgrade,
                "previousPlan": user.plan if is_upgrade else None,
            },
        }
        if d1 is not None:
            await billing_d1.create_payment_record(d1, **record_kwargs)
        else:
            await create_payment_record(session, **record_kwargs)
        return {"id": checkout_id, "short_url": url}
    except Exception as err:  # noqa: BLE001 — mirror TS 502 envelope
        logger.error("[yomi/billing] create-subscription failed: %s", err)
        msg = str(err)
        conf = get_dodo_config()
        return JSONResponse(
            {
                "error": "Dodo checkout creation failed",
                "cause": msg if "Dodo " in msg else f"internal: {msg}",
                "environment": conf["mode"],
                "targetBase": conf["api_base"],
            },
            502,
        )


@billing_router.post("/create-credit-pack")
async def create_credit_pack(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    pack_key = body.get("pack") if isinstance(body, dict) else None
    if effective_plan_for_user({"plan": user.plan}) == "explore":
        return JSONResponse(
            {"error": "Credit packs are only available on Pro and Max plans"}, 403
        )
    config = get_credit_pack(pack_key)
    if not config:
        return JSONResponse({"error": "Invalid credit pack"}, 400)

    product_id = get_dodo_config()["product_ids"].get(config["key"])
    if not product_id:
        return JSONResponse({"error": "Dodo product not configured for this credit pack"}, 500)

    try:
        checkout = await create_dodo_checkout(
            {
                "productId": product_id,
                "user": {"id": user.id, "name": user.name, "email": user.email},
                "metadata": {
                    "userId": user.id,
                    "kind": "credit_pack",
                    "productKey": config["key"],
                },
            }
        )
        url = checkout_url(checkout)
        if not url:
            raise RuntimeError("Dodo checkout response did not include a checkout URL")

        record_kwargs = {
            "user_id": user.id,
            "provider": "dodo",
            "kind": "credit_pack",
            "product_key": config["key"],
            "provider_order_id": (
                str(
                    checkout.get("session_id")
                    or checkout.get("id")
                    or checkout.get("checkout_id")
                    or ""
                )
                or None
            ),
            "amount_cents": config["priceCents"],
            "currency": config["currency"],
            "status": "created",
            "metadata": {"checkout": checkout},
        }
        if d1 is not None:
            await billing_d1.create_payment_record(d1, **record_kwargs)
        else:
            await create_payment_record(session, **record_kwargs)
        return {
            "id": str(checkout.get("id") or checkout.get("checkout_id") or ""),
            "short_url": url,
        }
    except Exception as err:  # noqa: BLE001 — mirror TS 502 envelope
        logger.error("[yomi/billing] create-credit-pack failed: %s", err)
        msg = str(err)
        conf = get_dodo_config()
        return JSONResponse(
            {
                "error": "Dodo checkout creation failed",
                "cause": msg if "Dodo " in msg else f"internal: {msg}",
                "environment": conf["mode"],
                "targetBase": conf["api_base"],
            },
            502,
        )


@billing_router.post("/cancel-subscription")
async def cancel_subscription(
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    if not user.dodo_subscription_id:
        return JSONResponse({"error": "No active subscription"}, 404)
    try:
        await dodo_request(
            f"/subscriptions/{user.dodo_subscription_id}",
            {"cancel_at_next_billing_date": True},
            "PATCH",
        )
        return {
            "ok": True,
            "message": "Your subscription will cancel at the end of the billing period.",
        }
    except Exception as err:  # noqa: BLE001 — mirror TS 502 envelope
        logger.error("[yomi/billing] cancel-subscription failed: %s", err)
        msg = str(err)
        conf = get_dodo_config()
        return JSONResponse(
            {
                "error": "Failed to cancel subscription",
                "cause": msg if "Dodo " in msg else f"internal: {msg}",
                "environment": conf["mode"],
                "targetBase": conf["api_base"],
            },
            502,
        )


@billing_router.post("/webhook")
async def billing_webhook(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    body = (await request.body()).decode("utf-8", errors="replace")
    if not verify_dodo_webhook(body, request.headers):
        return JSONResponse({"error": "Invalid signature"}, 400)

    try:
        event = json.loads(body)
    except ValueError:
        return JSONResponse({"error": "Invalid JSON"}, 400)

    type_ = event_type(event)
    event_id = (
        request.headers.get("webhook-id")
        or string_field(event, ["id", "event_id"])
        or f"{type_}:{payload_hash(body)}"
    )
    if d1 is not None:
        recorded = await billing_d1.record_payment_event(
            d1,
            provider="dodo",
            event_id=event_id,
            event_type=type_,
            payload_hash_value=payload_hash(body),
        )
    else:
        recorded = await record_payment_event(
            session,
            provider="dodo",
            event_id=event_id,
            event_type=type_,
            payload_hash_value=payload_hash(body),
        )
    if recorded["duplicate"]:
        return {"ok": True, "deduplicated": True}

    entity = event_data(event)
    try:
        if d1 is not None:
            await handle_dodo_event_d1(d1, type_, entity, event_id)
        else:
            await handle_dodo_event(session, type_, entity, event_id)
    except Exception as err:  # noqa: BLE001 — mirror TS 500 envelope
        logger.error("[yomi/billing] webhook handler error: %s", err)
        return JSONResponse({"error": "Handler error"}, 500)

    return {"ok": True}


@billing_router.get("/subscription")
async def subscription_info(
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        return await subscription_info_d1(d1, user.id)
    row = (
        await session.execute(
            select(
                User.name,
                User.email,
                User.role,
                User.plan,
                User.subscription_status,
                User.created_at,
                User.trial_start_date,
                User.trial_end_date,
                User.current_period_end,
                User.dodo_subscription_id,
            ).where(User.id == user.id).limit(1)
        )
    ).one_or_none()
    if row is None:
        return JSONResponse({"error": "User not found"}, 404)

    effective_plan = effective_plan_for_user(
        {"plan": row.plan, "trial_end_date": row.trial_end_date}
    )
    now = datetime.now(UTC)
    request_period_start = datetime(now.year, now.month, 1, tzinfo=UTC)
    renewal = credit_renewal(
        {
            "plan": row.plan,
            "trial_end_date": row.trial_end_date,
            "created_at": row.created_at,
            "current_period_end": row.current_period_end,
        }
    )

    consumption = (
        await session.execute(
            select(UsageEvent.kind, func.sum(UsageEvent.credits_charged).label("credits"))
            .where(
                UsageEvent.user_id == user.id,
                UsageEvent.created_at >= request_period_start,
                UsageEvent.credits_charged > 0,
            )
            .group_by(UsageEvent.kind)
        )
    ).all()
    credit_consumption: dict[str, int] = {}
    for kind, credits in consumption:
        credit_consumption[str(kind)] = int(credits or 0)

    total_credits_used = sum(credit_consumption.values())
    credit_summary = await get_credit_summary(session, user.id)
    total_credits = credit_summary.balance + total_credits_used

    trial_expired = False
    if effective_plan == "explore":
        trial_end = row.trial_end_date or (
            row.created_at + timedelta(days=30) if row.created_at else now
        )
        end = trial_end.replace(tzinfo=UTC) if trial_end.tzinfo is None else trial_end
        trial_expired = now >= end

    credit_packs = (
        list(CREDIT_PACKS.values()) if effective_plan != "explore" else []
    )

    return {
        "name": row.name,
        "email": row.email,
        "role": effective_role_for_user({"role": row.role}),
        "plan": effective_plan,
        "status": row.subscription_status,
        "trialExpired": trial_expired,
        "currentPeriodEnd": row.current_period_end,
        "dodoSubscriptionId": row.dodo_subscription_id,
        "resetAt": renewal[1],
        "resetKind": renewal[0],
        "credits": {
            "balance": credit_summary.balance,
            "lifetimeGranted": credit_summary.lifetime_granted,
            "lifetimeConsumed": credit_summary.lifetime_consumed,
            "lifetimeRefunded": credit_summary.lifetime_refunded,
            "expiringSoon": credit_summary.expiring_soon,
            "expiringSoonAt": credit_summary.expiring_soon_at,
        },
        "creditsUsed": total_credits_used,
        "totalCredits": total_credits,
        "creditPacks": credit_packs,
        "billingWarning": (
            "Your payment is past due. Please update your payment method."
            if row.subscription_status == "past_due"
            else None
        ),
    }


@billing_router.get("/usage-summary")
async def usage_summary(
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        return await usage_summary_d1(d1, user)
    effective_plan = effective_plan_for_user(
        {"plan": user.plan, "trial_start_date": user.trial_start_date}
    )
    plan_config = get_plan(effective_plan)
    now = datetime.now(UTC)
    if effective_plan == "explore" and user.trial_start_date:
        request_period_start = user.trial_start_date
    else:
        request_period_start = datetime(now.year, now.month, 1, tzinfo=UTC)

    if request_period_start.tzinfo is None:
        request_period_start = request_period_start.replace(tzinfo=UTC)
    renewal = credit_renewal(
        {
            "plan": user.plan,
            "trial_start_date": user.trial_start_date,
            "trial_end_date": user.trial_end_date,
            "created_at": user.created_at,
            "current_period_end": user.current_period_end,
        }
    )

    consumption = (
        await session.execute(
            select(func.coalesce(func.sum(UsageEvent.credits_charged), 0).label("credits"))
            .where(
                UsageEvent.user_id == user.id,
                UsageEvent.created_at >= request_period_start,
                UsageEvent.credits_charged > 0,
            )
        )
    ).scalar_one()
    daily_rows = (
        await session.execute(
            select(
                func.to_char(UsageEvent.created_at, "YYYY-MM-DD").label("date"),
                func.coalesce(func.sum(UsageEvent.credits_charged), 0).label("credits"),
            )
            .where(
                UsageEvent.user_id == user.id,
                UsageEvent.created_at >= request_period_start,
            )
            .group_by(func.to_char(UsageEvent.created_at, "YYYY-MM-DD"))
        )
    ).all()
    transactions = await recent_credit_transactions(session, user.id, 10)

    credit_summary = await get_credit_summary(session, user.id)
    credits_used = int(consumption or 0)
    total_available = credit_summary.balance + credits_used

    recent_activity = []
    for index, tx in enumerate(transactions):
        created = tx["created_at"] or datetime.now(UTC)
        created_ms = int(created.timestamp() * 1000)
        recent_activity.append(
            {
                "id": f"activity-{index}-{created_ms}",
                "label": (
                    "Credits Added"
                    if tx["type"] == "grant"
                    else activity_label(tx.get("usage_kind"), tx.get("reason"))
                ),
                "category": (
                    "credits_added"
                    if tx["type"] == "grant"
                    else category_for_activity(tx.get("usage_kind"), tx.get("reason"))
                ),
                "credits": abs(int(tx["amount"])),
                "createdAt": tx.get("usage_created_at") or created,
            }
        )

    return {
        "plan": {
            "key": effective_plan,
            "name": plan_config["name"],
            "status": user.subscription_status or "inactive",
        },
        "credits": {
            "remaining": credit_summary.balance,
            "included": plan_config["includedCredits"],
            "used": credits_used,
            "totalAvailableThisPeriod": total_available,
            "resetAt": renewal[1],
            "resetKind": renewal[0],
            "expiringSoon": credit_summary.expiring_soon,
            "expiringSoonAt": credit_summary.expiring_soon_at,
        },
        "monthlyUsage": {
            "days": [{"date": r.date, "credits": int(r.credits or 0)} for r in daily_rows]
        },
        "recentActivity": recent_activity,
        "actions": {
            "canBuyCredits": effective_plan != "explore",
            "canUpgrade": effective_plan != "max",
            "upgradeUrl": "/dashboard?upgrade=true",
        },
    }


async def subscription_info_d1(backend: D1Backend, user_id: str) -> dict | JSONResponse:
    row = await backend.store.fetch_one(
        "SELECT name, email, role, plan, subscription_status, created_at, "
        "trial_start_date, trial_end_date, current_period_end, dodo_subscription_id "
        "FROM user WHERE id = ? LIMIT 1",
        [user_id],
    )
    if row is None:
        return JSONResponse({"error": "User not found"}, 404)
    created_at = _parse_dt(row["created_at"])
    trial_end = _parse_dt(row.get("trial_end_date"))
    period_end = _parse_dt(row.get("current_period_end"))

    effective_plan = effective_plan_for_user({"plan": row["plan"], "trial_end_date": trial_end})
    now = datetime.now(UTC)
    request_period_start = datetime(now.year, now.month, 1, tzinfo=UTC)
    renewal = credit_renewal({
        "plan": row["plan"],
        "trial_end_date": trial_end,
        "created_at": created_at,
        "current_period_end": period_end,
    })
    consumption = await backend.store.fetch_all(
        "SELECT kind, SUM(credits_charged) AS credits FROM usage_events "
        "WHERE user_id = ? AND created_at >= ? AND credits_charged > 0 GROUP BY kind",
        [user_id, request_period_start.isoformat()],
    )
    credit_consumption = {str(r["kind"]): int(r["credits"] or 0) for r in consumption}
    total_credits_used = sum(credit_consumption.values())
    credit_summary = await billing_d1.get_credit_summary(backend, user_id)
    total_credits = credit_summary.balance + total_credits_used

    trial_expired = False
    if effective_plan == "explore":
        end = trial_end or (
            created_at + timedelta(days=30) if created_at else now
        )
        if end.tzinfo is None:
            end = end.replace(tzinfo=UTC)
        trial_expired = now >= end

    return {
        "name": row["name"],
        "email": row["email"],
        "role": effective_role_for_user({"role": row["role"]}),
        "plan": effective_plan,
        "status": row["subscription_status"],
        "trialExpired": trial_expired,
        "currentPeriodEnd": row["current_period_end"],
        "dodoSubscriptionId": row["dodo_subscription_id"],
        "resetAt": renewal[1],
        "resetKind": renewal[0],
        "credits": {
            "balance": credit_summary.balance,
            "lifetimeGranted": credit_summary.lifetime_granted,
            "lifetimeConsumed": credit_summary.lifetime_consumed,
            "lifetimeRefunded": credit_summary.lifetime_refunded,
            "expiringSoon": credit_summary.expiring_soon,
            "expiringSoonAt": credit_summary.expiring_soon_at,
        },
        "creditsUsed": total_credits_used,
        "totalCredits": total_credits,
        "creditPacks": list(CREDIT_PACKS.values()) if effective_plan != "explore" else [],
        "billingWarning": (
            "Your payment is past due. Please update your payment method."
            if row["subscription_status"] == "past_due"
            else None
        ),
    }


async def usage_summary_d1(backend: D1Backend, user: User) -> dict:
    effective_plan = effective_plan_for_user(
        {"plan": user.plan, "trial_start_date": user.trial_start_date}
    )
    plan_config = get_plan(effective_plan)
    now = datetime.now(UTC)
    if effective_plan == "explore" and user.trial_start_date:
        request_period_start = user.trial_start_date
    else:
        request_period_start = datetime(now.year, now.month, 1, tzinfo=UTC)
    if request_period_start.tzinfo is None:
        request_period_start = request_period_start.replace(tzinfo=UTC)
    renewal = credit_renewal(
        {
            "plan": user.plan,
            "trial_start_date": user.trial_start_date,
            "trial_end_date": user.trial_end_date,
            "created_at": user.created_at,
            "current_period_end": user.current_period_end,
        }
    )
    period_iso = request_period_start.isoformat()
    consumption = await backend.store.fetch_one(
        "SELECT COALESCE(SUM(credits_charged), 0) AS credits FROM usage_events "
        "WHERE user_id = ? AND created_at >= ? AND credits_charged > 0",
        [user.id, period_iso],
    )
    daily_rows = await backend.store.fetch_all(
        "SELECT SUBSTR(created_at, 1, 10) AS date, "
        "COALESCE(SUM(credits_charged), 0) AS credits FROM usage_events "
        "WHERE user_id = ? AND created_at >= ? GROUP BY SUBSTR(created_at, 1, 10)",
        [user.id, period_iso],
    )
    transactions = await billing_d1.recent_credit_transactions(backend, user.id, 10)
    credit_summary = await billing_d1.get_credit_summary(backend, user.id)
    credits_used = int((consumption or {}).get("credits") or 0)
    total_available = credit_summary.balance + credits_used

    recent_activity = []
    for index, tx in enumerate(transactions):
        created = _parse_dt(tx["created_at"]) or datetime.now(UTC)
        created_ms = int(created.timestamp() * 1000)
        recent_activity.append(
            {
                "id": f"activity-{index}-{created_ms}",
                "label": (
                    "Credits Added"
                    if tx["type"] == "grant"
                    else activity_label(tx.get("usage_kind"), tx.get("reason"))
                ),
                "category": (
                    "credits_added"
                    if tx["type"] == "grant"
                    else category_for_activity(tx.get("usage_kind"), tx.get("reason"))
                ),
                "credits": abs(int(tx["amount"])),
                "createdAt": tx.get("usage_created_at") or created.isoformat(),
            }
        )

    return {
        "plan": {
            "key": effective_plan,
            "name": plan_config["name"],
            "status": user.subscription_status or "inactive",
        },
        "credits": {
            "remaining": credit_summary.balance,
            "included": plan_config["includedCredits"],
            "used": credits_used,
            "totalAvailableThisPeriod": total_available,
            "resetAt": renewal[1],
            "resetKind": renewal[0],
            "expiringSoon": credit_summary.expiring_soon,
            "expiringSoonAt": credit_summary.expiring_soon_at,
        },
        "monthlyUsage": {
            "days": [{"date": r["date"], "credits": int(r["credits"] or 0)} for r in daily_rows]
        },
        "recentActivity": recent_activity,
        "actions": {
            "canBuyCredits": effective_plan != "explore",
            "canUpgrade": effective_plan != "max",
            "upgradeUrl": "/dashboard?upgrade=true",
        },
    }


async def handle_dodo_event(
    session: AsyncSession, type_: str, entity: DodoEntity, event_id: str
) -> None:
    normalized = type_.lower()
    if "subscription" in normalized and re.search(r"active|renew|paid|success|charge", normalized):
        await handle_subscription_active(session, entity, event_id)
        return
    if "subscription" in normalized and re.search(r"cancel|expire|complete", normalized):
        await handle_subscription_end(session, entity)
        return
    if "subscription" in normalized and re.search(
        r"fail|past_due|halt|on_hold|(^|\.)paused$", normalized
    ):
        await handle_payment_failed(session, entity)
        return
    if "payment" in normalized and re.search(r"success|succeed|paid|captured", normalized):
        await handle_payment_succeeded(session, entity, event_id)


async def find_user_by_subscription(session: AsyncSession, sub_id: str) -> str | None:
    return (
        await session.execute(
            select(User.id).where(User.dodo_subscription_id == sub_id).limit(1)
        )
    ).scalar_one_or_none()


async def handle_subscription_active(
    session: AsyncSession, entity: DodoEntity, event_id: str
) -> None:
    meta = metadata_of(entity)
    sub_id = string_field(entity, ["subscription_id", "id"])
    user_id = meta.get("userId")
    plan = meta.get("plan")

    if not user_id and sub_id:
        user_id = await find_user_by_subscription(session, sub_id)
    if not user_id or not plan:
        return

    config = PLANS.get(plan)
    if not config:
        return

    customer_id = string_field(entity, ["customer_id", "customerId"])
    period_end = date_field(entity, ["current_period_end", "currentPeriodEnd", "next_billing_date"])

    existing = (
        await session.execute(
            select(User.plan, User.dodo_subscription_id).where(User.id == user_id).limit(1)
        )
    ).one_or_none()

    existing_plan = existing.plan if existing else None
    existing_sub = existing.dodo_subscription_id if existing else None
    is_renewal = existing_plan == plan
    is_upgrade = (
        existing_plan is not None
        and existing_plan != "explore"
        and existing_plan != plan
    )

    if is_upgrade and existing_sub and existing_sub != sub_id:
        try:
            logger.warning(
                "[yomi/billing] cancelling old subscription %s for upgrade to %s",
                existing_sub,
                plan,
            )
            await dodo_request(
                f"/subscriptions/{existing_sub}", {"cancel_at_next_billing_date": True}, "PATCH"
            )
        except Exception as err:  # noqa: BLE001 — best-effort
            logger.warning("[yomi/billing] failed to cancel old subscription on upgrade: %s", err)

    payment_id = await upsert_payment_record(
        session,
        user_id=user_id,
        provider="dodo",
        kind="subscription",
        product_key=plan,
        provider_customer_id=customer_id,
        provider_order_id=sub_id,
        provider_subscription_id=sub_id,
        amount_cents=config["priceCents"],
        currency="USD",
        status="paid",
        metadata={
            "providerEvent": {"type": "subscription_active", "eventId": event_id},
            "plan": plan,
            "isRenewal": is_renewal,
            "previousPlan": existing_plan,
        },
    )

    await session.execute(
        update(User)
        .where(User.id == user_id)
        .values(
            plan=plan,
            subscription_status="active",
            dodo_customer_id=customer_id,
            dodo_subscription_id=sub_id,
            current_period_end=period_end,
        )
    )

    if existing_plan == "explore" and plan != "explore":
        now = datetime.now(UTC)
        month_start = datetime(now.year, now.month, 1, tzinfo=UTC)
        await session.execute(
            delete(UsageEvent).where(
                UsageEvent.user_id == user_id,
                UsageEvent.created_at >= month_start,
            )
        )
        try:
            expired = await expire_user_credits(
                session,
                user_id,
                sources=["subscription_cycle", "promo"],
                reason="credits expired on upgrade from Explore",
            )
            if expired > 0:
                logger.info(
                    "[yomi/billing] expired %d credits on upgrade from Explore to %s",
                    expired,
                    plan,
                )
        except Exception as err:  # noqa: BLE001 — best-effort
            logger.error("[yomi/billing] failed to expire credits on upgrade: %s", err)

    if config["includedCredits"] <= 0:
        return

    try:
        await grant_credits(
            session,
            user_id=user_id,
            amount=config["includedCredits"],
            source="subscription_cycle",
            source_id=(
                f"{sub_id or 'subscription'}:"
                f"{period_end.isoformat() if period_end else event_id}"
            ),
            idempotency_key=f"dodo:{event_id}:subscription_credits",
            payment_id=payment_id,
            expires_at=subscription_credit_expiry(period_end),
            reason=f"{config['name']} monthly credits",
            metadata={
                "provider": "dodo",
                "subscriptionId": sub_id,
                "plan": plan,
                "isRenewal": is_renewal,
            },
        )
    except Exception as err:  # noqa: BLE001 — best-effort
        logger.error("[yomi/billing] grantCredits failed for subscription %s: %s", event_id, err)


async def handle_subscription_end(session: AsyncSession, entity: DodoEntity) -> None:
    meta = metadata_of(entity)
    sub_id = string_field(entity, ["subscription_id", "id"])
    user_id = meta.get("userId")

    if not user_id and sub_id:
        user_id = await find_user_by_subscription(session, sub_id)
    if not user_id:
        return

    if sub_id:
        rec = (
            await session.execute(
                select(PaymentRecord.id).where(
                    PaymentRecord.provider == "dodo",
                    PaymentRecord.provider_order_id == sub_id,
                ).limit(1)
            )
        ).scalar_one_or_none()
        if rec:
            await session.execute(
                update(PaymentRecord)
                .where(PaymentRecord.id == rec)
                .values(
                    status="cancelled",
                    updated_at=datetime.now(UTC),
                    metadata_={"cancelledAt": datetime.now(UTC).isoformat()},
                )
            )

    await session.execute(
        update(User)
        .where(User.id == user_id)
        .values(
            plan="explore",
            subscription_status="inactive",
            dodo_subscription_id=None,
            current_period_end=None,
        )
    )


async def handle_payment_failed(session: AsyncSession, entity: DodoEntity) -> None:
    meta = metadata_of(entity)
    sub_id = string_field(entity, ["subscription_id", "id"])
    user_id = meta.get("userId")

    if not user_id and sub_id:
        user_id = await find_user_by_subscription(session, sub_id)
    if not user_id:
        return

    await session.execute(
        update(User).where(User.id == user_id).values(subscription_status="past_due")
    )


async def handle_payment_succeeded(
    session: AsyncSession, entity: DodoEntity, event_id: str
) -> None:
    meta = metadata_of(entity)
    if meta.get("kind") != "credit_pack" or not meta.get("userId") or not meta.get("productKey"):
        return

    pack = get_credit_pack(meta["productKey"])
    if not pack:
        return

    payment_id = await upsert_payment_record(
        session,
        user_id=meta["userId"],
        provider="dodo",
        kind="credit_pack",
        product_key=pack["key"],
        provider_customer_id=string_field(entity, ["customer_id", "customerId"]),
        provider_order_id=string_field(entity, ["checkout_id", "payment_link_id", "order_id"]),
        provider_payment_id=string_field(entity, ["payment_id", "id"]),
        amount_cents=int(number_field(entity, ["amount", "total_amount"]) or pack["priceCents"]),
        currency=string_field(entity, ["currency"]) or pack["currency"],
        status="paid",
        metadata={"providerEvent": {"eventId": event_id, "type": "payment_succeeded"}},
    )

    expires_at = datetime.now(UTC) + timedelta(days=365)
    try:
        await grant_credits(
            session,
            user_id=meta["userId"],
            amount=pack["credits"],
            source="credit_pack",
            source_id=string_field(entity, ["payment_id", "id", "checkout_id"]) or event_id,
            idempotency_key=f"dodo:{event_id}:credit_pack:{pack['key']}",
            payment_id=payment_id,
            expires_at=expires_at,
            reason=f"{pack['name']} purchase",
            metadata={"provider": "dodo", "productKey": pack["key"]},
        )
    except Exception as err:  # noqa: BLE001 — best-effort
        logger.error("[yomi/billing] grantCredits failed for payment %s: %s", event_id, err)


# ---------------------------------------------------------------------------
# D1 counterparts: same webhook chain and read shapes on the storage gateway.
# ---------------------------------------------------------------------------

def _iso_or_none(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()


async def _update_user_d1(backend: D1Backend, user_id: str, values: dict[str, Any]) -> None:
    encoded = {
        key: (_iso_or_none(value) if isinstance(value, datetime) else value)
        for key, value in values.items()
    }
    assignments = ", ".join(f"{key} = ?" for key in encoded)
    await backend.store.atomic([
        Statement(
            f"UPDATE user SET {assignments} WHERE id = ?",
            [*encoded.values(), user_id],
        )
    ])


async def find_user_by_subscription_d1(backend: D1Backend, sub_id: str) -> str | None:
    row = await backend.store.fetch_one(
        "SELECT id FROM user WHERE dodo_subscription_id = ? LIMIT 1", [sub_id]
    )
    return str(row["id"]) if row else None


async def handle_dodo_event_d1(
    backend: D1Backend, type_: str, entity: DodoEntity, event_id: str
) -> None:
    normalized = type_.lower()
    if "subscription" in normalized and re.search(r"active|renew|paid|success|charge", normalized):
        await handle_subscription_active_d1(backend, entity, event_id)
        return
    if "subscription" in normalized and re.search(r"cancel|expire|complete", normalized):
        await handle_subscription_end_d1(backend, entity)
        return
    if "subscription" in normalized and re.search(
        r"fail|past_due|halt|on_hold|(^|\.)paused$", normalized
    ):
        await handle_payment_failed_d1(backend, entity)
        return
    if "payment" in normalized and re.search(r"success|succeed|paid|captured", normalized):
        await handle_payment_succeeded_d1(backend, entity, event_id)


async def handle_subscription_active_d1(
    backend: D1Backend, entity: DodoEntity, event_id: str
) -> None:
    meta = metadata_of(entity)
    sub_id = string_field(entity, ["subscription_id", "id"])
    user_id = meta.get("userId")
    plan = meta.get("plan")

    if not user_id and sub_id:
        user_id = await find_user_by_subscription_d1(backend, sub_id)
    if not user_id or not plan:
        return

    config = PLANS.get(plan)
    if not config:
        return

    customer_id = string_field(entity, ["customer_id", "customerId"])
    period_end = date_field(entity, ["current_period_end", "currentPeriodEnd", "next_billing_date"])

    existing = await backend.store.fetch_one(
        "SELECT plan, dodo_subscription_id FROM user WHERE id = ? LIMIT 1", [user_id]
    )
    existing_plan = existing["plan"] if existing else None
    existing_sub = existing["dodo_subscription_id"] if existing else None
    is_renewal = existing_plan == plan
    is_upgrade = (
        existing_plan is not None
        and existing_plan != "explore"
        and existing_plan != plan
    )

    if is_upgrade and existing_sub and existing_sub != sub_id:
        try:
            logger.warning(
                "[yomi/billing] cancelling old subscription %s for upgrade to %s",
                existing_sub,
                plan,
            )
            await dodo_request(
                f"/subscriptions/{existing_sub}", {"cancel_at_next_billing_date": True}, "PATCH"
            )
        except Exception as err:  # noqa: BLE001 — best-effort
            logger.warning("[yomi/billing] failed to cancel old subscription on upgrade: %s", err)

    payment_id = await billing_d1.upsert_payment_record(
        backend,
        user_id=user_id,
        provider="dodo",
        kind="subscription",
        product_key=plan,
        provider_customer_id=customer_id,
        provider_order_id=sub_id,
        provider_subscription_id=sub_id,
        amount_cents=config["priceCents"],
        currency="USD",
        status="paid",
        metadata={
            "providerEvent": {"type": "subscription_active", "eventId": event_id},
            "plan": plan,
            "isRenewal": is_renewal,
            "previousPlan": existing_plan,
        },
    )

    await _update_user_d1(backend, user_id, {
        "plan": plan,
        "subscription_status": "active",
        "dodo_customer_id": customer_id,
        "dodo_subscription_id": sub_id,
        "current_period_end": period_end,
    })

    if existing_plan == "explore" and plan != "explore":
        now = datetime.now(UTC)
        month_start = datetime(now.year, now.month, 1, tzinfo=UTC).isoformat()
        await backend.store.atomic([
            Statement(
                "DELETE FROM usage_events WHERE user_id = ? AND created_at >= ?",
                [user_id, month_start],
            )
        ])
        try:
            expired = await billing_d1.expire_user_credits(
                backend,
                user_id,
                sources=["subscription_cycle", "promo"],
                reason="credits expired on upgrade from Explore",
            )
            if expired > 0:
                logger.info(
                    "[yomi/billing] expired %d credits on upgrade from Explore to %s",
                    expired,
                    plan,
                )
        except Exception as err:  # noqa: BLE001 — best-effort
            logger.error("[yomi/billing] failed to expire credits on upgrade: %s", err)

    if config["includedCredits"] <= 0:
        return

    try:
        await billing_d1.grant_credits(
            backend,
            user_id=user_id,
            amount=config["includedCredits"],
            source="subscription_cycle",
            source_id=(
                f"{sub_id or 'subscription'}:"
                f"{period_end.isoformat() if period_end else event_id}"
            ),
            idempotency_key=f"dodo:{event_id}:subscription_credits",
            payment_id=payment_id,
            expires_at=subscription_credit_expiry(period_end),
            reason=f"{config['name']} monthly credits",
            metadata={
                "provider": "dodo",
                "subscriptionId": sub_id,
                "plan": plan,
                "isRenewal": is_renewal,
            },
        )
    except Exception as err:  # noqa: BLE001 — best-effort
        logger.error("[yomi/billing] grantCredits failed for subscription %s: %s", event_id, err)


async def handle_subscription_end_d1(backend: D1Backend, entity: DodoEntity) -> None:
    meta = metadata_of(entity)
    sub_id = string_field(entity, ["subscription_id", "id"])
    user_id = meta.get("userId")

    if not user_id and sub_id:
        user_id = await find_user_by_subscription_d1(backend, sub_id)
    if not user_id:
        return

    if sub_id:
        rec = await backend.store.fetch_one(
            "SELECT id FROM payment_records WHERE provider = 'dodo' AND provider_order_id = ? "
            "LIMIT 1",
            [sub_id],
        )
        if rec:
            now = utcnow_iso()
            await backend.store.atomic([
                Statement(
                    "UPDATE payment_records SET status = 'cancelled', updated_at = ?, "
                    "metadata = ? WHERE id = ?",
                    [now, {"cancelledAt": now}, rec["id"]],
                )
            ])

    await _update_user_d1(backend, user_id, {
        "plan": "explore",
        "subscription_status": "inactive",
        "dodo_subscription_id": None,
        "current_period_end": None,
    })


async def handle_payment_failed_d1(backend: D1Backend, entity: DodoEntity) -> None:
    meta = metadata_of(entity)
    sub_id = string_field(entity, ["subscription_id", "id"])
    user_id = meta.get("userId")

    if not user_id and sub_id:
        user_id = await find_user_by_subscription_d1(backend, sub_id)
    if not user_id:
        return

    await _update_user_d1(backend, user_id, {"subscription_status": "past_due"})


async def handle_payment_succeeded_d1(
    backend: D1Backend, entity: DodoEntity, event_id: str
) -> None:
    meta = metadata_of(entity)
    if meta.get("kind") != "credit_pack" or not meta.get("userId") or not meta.get("productKey"):
        return

    pack = get_credit_pack(meta["productKey"])
    if not pack:
        return

    payment_id = await billing_d1.upsert_payment_record(
        backend,
        user_id=meta["userId"],
        provider="dodo",
        kind="credit_pack",
        product_key=pack["key"],
        provider_customer_id=string_field(entity, ["customer_id", "customerId"]),
        provider_order_id=string_field(entity, ["checkout_id", "payment_link_id", "order_id"]),
        provider_payment_id=string_field(entity, ["payment_id", "id"]),
        amount_cents=int(number_field(entity, ["amount", "total_amount"]) or pack["priceCents"]),
        currency=string_field(entity, ["currency"]) or pack["currency"],
        status="paid",
        metadata={"providerEvent": {"eventId": event_id, "type": "payment_succeeded"}},
    )

    expires_at = datetime.now(UTC) + timedelta(days=365)
    try:
        await billing_d1.grant_credits(
            backend,
            user_id=meta["userId"],
            amount=pack["credits"],
            source="credit_pack",
            source_id=string_field(entity, ["payment_id", "id", "checkout_id"]) or event_id,
            idempotency_key=f"dodo:{event_id}:credit_pack:{pack['key']}",
            payment_id=payment_id,
            expires_at=expires_at,
            reason=f"{pack['name']} purchase",
            metadata={"provider": "dodo", "productKey": pack["key"]},
        )
    except Exception as err:  # noqa: BLE001 — best-effort
        logger.error("[yomi/billing] grantCredits failed for payment %s: %s", event_id, err)
