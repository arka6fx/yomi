"""User Vault on D1: logins, cards, personal info and agent-held accounts.

Secrets (passwords, card numbers, CVVs) are AES-256-GCM encrypted with the same
key as OAuth tokens and never leave this module except as keystrokes typed into
the user's own isolated desktop. The model sees item ids and ``public`` fields.

Cards are gated twice: every payment needs an explicit approval (a
``vault-authorizePayment`` pending action), and the card number/CVV can only be
typed while that approval's short-lived authorization window is open. Approved
payments form the user's spend ledger, and an optional per-card monthly limit
is enforced before an approval is even requested.
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from yomi.connectors.base import PAID
from yomi.crypto import decrypt_string, encrypt_string
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import new_id, utcnow_iso

KINDS = ("login", "card", "address", "phone", "agent_item")
AUTHORIZATION_WINDOW = timedelta(minutes=15)
SPENDING_STATUSES = ("authorized", "completed")

# kind -> (public fields, secret fields, required fields)
_SCHEMA: dict[str, tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]]] = {
    "login": (("url", "username"), ("password",), ("username", "password")),
    "card": (
        ("cardholder", "exp_month", "exp_year", "billing_zip", "monthly_limit", "currency"),
        ("number", "cvv"),
        ("number", "exp_month", "exp_year", "cvv"),
    ),
    "address": (
        ("line1", "line2", "city", "state", "postal_code", "country"),
        (),
        ("line1", "city", "country"),
    ),
    "phone": (("number",), (), ("number",)),
    "agent_item": (("service", "url", "username", "notes"), ("password",), ("service",)),
}

# Fields the agent may type into the desktop, and whether each needs an open
# payment authorization first.
TYPEABLE: dict[str, dict[str, bool]] = {
    "login": {"username": False, "password": False},
    "agent_item": {"username": False, "password": False},
    "card": {
        "number": True,
        "cvv": True,
        "expiry": True,
        "exp_month": True,
        "exp_year": True,
        "cardholder": False,
        "billing_zip": False,
    },
    "address": {
        f: False for f in ("line1", "line2", "city", "state", "postal_code", "country")
    },
    "phone": {"number": False},
}


class VaultError(ValueError):
    """Invalid vault input or a refused vault operation."""


def _clean(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def luhn_ok(number: str) -> bool:
    digits = [int(c) for c in number if c.isdigit()]
    if len(digits) < 12 or len(digits) > 19:
        return False
    total = 0
    for index, digit in enumerate(reversed(digits)):
        if index % 2 == 1:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


def card_brand(number: str) -> str:
    if re.match(r"^4", number):
        return "Visa"
    if re.match(r"^(5[1-5]|2[2-7])", number):
        return "Mastercard"
    if re.match(r"^3[47]", number):
        return "Amex"
    if re.match(r"^(6011|64[4-9]|65)", number):
        return "Discover"
    if re.match(r"^(508|60|81|82)", number):
        return "RuPay"
    return "Card"


def to_minor(amount: Any) -> int:
    """Major-unit amount (e.g. 12.5) -> integer minor units (1250)."""
    try:
        value = round(float(amount) * 100)
    except (TypeError, ValueError) as exc:
        raise VaultError("amount must be a number") from exc
    if value <= 0:
        raise VaultError("amount must be positive")
    return value


def normalize_item(kind: str, label: str, fields: dict[str, Any]) -> tuple[dict, dict]:
    """Validate raw form fields into (public, secret) dicts for storage."""
    if kind not in _SCHEMA:
        raise VaultError(f"kind must be one of {', '.join(KINDS)}")
    if not _clean(label):
        raise VaultError("name is required")
    public_keys, secret_keys, required = _SCHEMA[kind]
    values = {k: _clean(fields.get(k)) for k in (*public_keys, *secret_keys)}
    missing = [k for k in required if not values.get(k)]
    if missing:
        raise VaultError(f"missing: {', '.join(missing)}")

    if kind == "card":
        number = re.sub(r"\D", "", values["number"])
        if not luhn_ok(number):
            raise VaultError("card number is not valid")
        if not re.fullmatch(r"\d{3,4}", values["cvv"]):
            raise VaultError("CVV must be 3 or 4 digits")
        month = int(values["exp_month"]) if values["exp_month"].isdigit() else 0
        if not 1 <= month <= 12:
            raise VaultError("expiry month must be 01-12")
        year = values["exp_year"]
        if not re.fullmatch(r"\d{2}|\d{4}", year):
            raise VaultError("expiry year must be YY or YYYY")
        values.update(number=number, exp_month=f"{month:02d}", exp_year=year[-2:])
        if values["monthly_limit"]:
            values["monthly_limit"] = str(to_minor(values["monthly_limit"]))
        values["currency"] = (values["currency"] or "INR").upper()

    public = {k: values[k] for k in public_keys if values.get(k)}
    secret = {k: values[k] for k in secret_keys if values.get(k)}
    if kind == "card":
        public["brand"] = card_brand(secret["number"])
        public["last4"] = secret["number"][-4:]
    return public, secret


def _load_json(value: Any) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def public_view(row: dict) -> dict[str, Any]:
    """What the dashboard and the model may see: never the secret blob."""
    public = _load_json(row.get("public"))
    if "monthly_limit" in public:
        public["monthly_limit"] = int(public["monthly_limit"]) / 100
    return {
        "id": str(row["id"]),
        "kind": row["kind"],
        "label": row["label"],
        "owner": row.get("owner") or "user",
        "fields": public,
        "hasSecret": bool(row.get("secret")),
        "lastUsedAt": row.get("last_used_at"),
        "createdAt": row.get("created_at"),
    }


async def list_items(backend: D1Backend, user_id: str, kind: str | None = None) -> list[dict]:
    if kind:
        rows = await backend.store.fetch_all(
            "SELECT * FROM vault_items WHERE user_id = ? AND kind = ? ORDER BY created_at",
            [user_id, kind],
        )
    else:
        rows = await backend.store.fetch_all(
            "SELECT * FROM vault_items WHERE user_id = ? ORDER BY created_at", [user_id]
        )
    return [public_view(row) for row in rows]


async def get_item(backend: D1Backend, user_id: str, item_id: str) -> dict | None:
    return await backend.store.fetch_one(
        "SELECT * FROM vault_items WHERE id = ? AND user_id = ? LIMIT 1", [item_id, user_id]
    )


async def create_item(
    backend: D1Backend,
    user_id: str,
    kind: str,
    label: str,
    fields: dict[str, Any],
    owner: str = "user",
) -> dict:
    public, secret = normalize_item(kind, label, fields)
    now = utcnow_iso()
    row = {
        "id": new_id(),
        "user_id": user_id,
        "kind": kind,
        "label": _clean(label)[:80],
        "public": public,
        "secret": encrypt_string(json.dumps(secret)) if secret else None,
        "owner": owner,
        "last_used_at": None,
        "created_at": now,
        "updated_at": now,
    }
    await backend.store.atomic([backend.store.insert("vault_items", row)])
    return public_view({**row, "public": json.dumps(public)})


async def delete_item(backend: D1Backend, user_id: str, item_id: str) -> bool:
    results = await backend.store.atomic([
        Statement(
            "DELETE FROM vault_items WHERE id = ? AND user_id = ? RETURNING id",
            [item_id, user_id],
        )
    ])
    return bool(results and results[0].get("results"))


def _field_value(row: dict, field: str) -> str:
    public = _load_json(row.get("public"))
    if row["kind"] == "card" and field == "expiry":
        return f"{public.get('exp_month', '')}/{public.get('exp_year', '')}"
    if field in public:
        return str(public[field])
    if row.get("secret"):
        secret = json.loads(decrypt_string(str(row["secret"])))
        if field in secret:
            return str(secret[field])
    raise VaultError(f"{row['label']} has no {field}")


async def open_authorization(backend: D1Backend, user_id: str, item_id: str) -> dict | None:
    return await backend.store.fetch_one(
        "SELECT * FROM vault_payments WHERE user_id = ? AND item_id = ? "
        "AND status = 'authorized' AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
        [user_id, item_id, utcnow_iso()],
    )


async def secret_for_typing(
    backend: D1Backend, user_id: str, item_id: str, field: str
) -> str:
    """Plain value to type into the desktop, after every vault gate passes."""
    row = await get_item(backend, user_id, item_id)
    if row is None:
        raise VaultError("vault item not found")
    allowed = TYPEABLE.get(row["kind"], {})
    if field not in allowed:
        raise VaultError(
            f"{field} can't be typed from a {row['kind']}; allowed: {', '.join(allowed)}"
        )
    if allowed[field] and await open_authorization(backend, user_id, item_id) is None:
        raise VaultError(
            "This card has no approved payment open. Call vault_request_payment first and "
            "wait for the user to approve it."
        )
    value = _field_value(row, field)
    await backend.store.atomic([
        Statement(
            "UPDATE vault_items SET last_used_at = ? WHERE id = ?", [utcnow_iso(), row["id"]]
        )
    ])
    return value


def _month_start() -> str:
    now = datetime.now(UTC)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()


async def month_spend_minor(backend: D1Backend, user_id: str, item_id: str) -> int:
    row = await backend.store.fetch_one(
        "SELECT COALESCE(SUM(amount_minor), 0) AS total FROM vault_payments "
        "WHERE user_id = ? AND item_id = ? AND status IN ('authorized', 'completed') "
        "AND created_at >= ?",
        [user_id, item_id, _month_start()],
    )
    return int((row or {}).get("total") or 0)


async def request_payment(
    backend: D1Backend,
    user_id: str,
    *,
    item_id: str,
    merchant: str,
    amount: Any,
    currency: str | None,
    purpose: str | None,
    create_pending_action: Callable[[dict], Awaitable[dict]],
) -> dict:
    """Record a pending payment and ask the user to approve it."""
    row = await get_item(backend, user_id, item_id)
    if row is None or row["kind"] != "card":
        raise VaultError("card not found in the vault")
    merchant = _clean(merchant)[:120]
    if not merchant:
        raise VaultError("merchant is required")
    public = _load_json(row.get("public"))
    card_currency = str(public.get("currency") or "INR").upper()
    currency = (_clean(currency) or card_currency).upper()
    amount_minor = to_minor(amount)

    limit = public.get("monthly_limit")
    if limit and currency == card_currency:
        spent = await month_spend_minor(backend, user_id, item_id)
        if spent + amount_minor > int(limit):
            raise VaultError(
                f"This would exceed the monthly limit on {row['label']} "
                f"({spent / 100:.2f} of {int(limit) / 100:.2f} {currency} used)."
            )

    payment_id = new_id()
    now = utcnow_iso()
    await backend.store.atomic([
        backend.store.insert("vault_payments", {
            "id": payment_id,
            "user_id": user_id,
            "item_id": item_id,
            "merchant": merchant,
            "amount_minor": amount_minor,
            "currency": currency,
            "purpose": _clean(purpose)[:280] or None,
            "status": "pending",
            "pending_action_id": None,
            "expires_at": None,
            "created_at": now,
            "updated_at": now,
        })
    ])
    label = f"{public.get('brand', 'Card')} ••{public.get('last4', '')}"
    pending = await create_pending_action({
        "connector": "vault",
        "action": "vault-authorizePayment",
        "risk": PAID,
        "title": f"Pay {amount_minor / 100:.2f} {currency} to {merchant}",
        "preview": (
            f"Merchant: {merchant}\nAmount: {amount_minor / 100:.2f} {currency}\n"
            f"Card: {row['label']} ({label})"
            + (f"\nFor: {_clean(purpose)[:280]}" if purpose else "")
        ),
        "confirm_text": "Approve payment",
        "payload": {"payment_id": payment_id},
    })
    if isinstance(pending, dict) and pending.get("id"):
        await backend.store.atomic([
            Statement(
                "UPDATE vault_payments SET pending_action_id = ? WHERE id = ?",
                [str(pending["id"]), payment_id],
            )
        ])
    return {"payment_id": payment_id, **(pending if isinstance(pending, dict) else {})}


async def authorize_payment(backend: D1Backend, user_id: str, payment_id: str) -> dict:
    """Approval side effect: open the card for typing for a short window."""
    expires = (datetime.now(UTC) + AUTHORIZATION_WINDOW).isoformat()
    results = await backend.store.atomic([
        Statement(
            "UPDATE vault_payments SET status = 'authorized', expires_at = ?, updated_at = ? "
            "WHERE id = ? AND user_id = ? AND status = 'pending' RETURNING id",
            [expires, utcnow_iso(), payment_id, user_id],
        )
    ])
    if not (results and results[0].get("results")):
        raise VaultError("payment is no longer pending")
    return {
        "ok": True,
        "payment_id": payment_id,
        "authorized_until": expires,
        "next": "The card can now be typed into checkout with vault_type for 15 minutes.",
    }


async def set_payment_status(
    backend: D1Backend, user_id: str, payment_id: str, status: str, *, from_status: str
) -> bool:
    results = await backend.store.atomic([
        Statement(
            "UPDATE vault_payments SET status = ?, updated_at = ? "
            "WHERE id = ? AND user_id = ? AND status = ? RETURNING id",
            [status, utcnow_iso(), payment_id, user_id, from_status],
        )
    ])
    return bool(results and results[0].get("results"))


async def list_payments(backend: D1Backend, user_id: str, limit: int = 100) -> dict[str, Any]:
    rows = await backend.store.fetch_all(
        "SELECT p.*, i.label AS card_label FROM vault_payments p "
        "LEFT JOIN vault_items i ON i.id = p.item_id "
        "WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT ?",
        [user_id, limit],
    )
    month_start = _month_start()
    totals: dict[str, float] = {}
    payments = []
    for row in rows:
        status = row["status"]
        if status == "authorized" and (row.get("expires_at") or "") <= utcnow_iso():
            status = "expired"
        amount = int(row["amount_minor"]) / 100
        if status in SPENDING_STATUSES and (row.get("created_at") or "") >= month_start:
            totals[row["currency"]] = totals.get(row["currency"], 0) + amount
        payments.append({
            "id": str(row["id"]),
            "itemId": row["item_id"],
            "card": row.get("card_label"),
            "merchant": row["merchant"],
            "amount": amount,
            "currency": row["currency"],
            "purpose": row.get("purpose"),
            "status": status,
            "createdAt": row.get("created_at"),
        })
    return {"payments": payments, "monthTotals": totals}
