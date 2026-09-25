"""Agent tools over the user's Vault (D1 only).

The model works with item ids and non-secret metadata. Secrets reach the
outside world only as keystrokes typed into the user's isolated desktop by
``vault_type``; tool results never echo them. Card payments always go through
``vault_request_payment`` -> user approval -> a 15-minute typing window.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from yomi.services import vault_d1
from yomi.services.cloudflare_storage.deps import D1Backend

_MODEL_FIELDS = {
    "login": ("url", "username"),
    "card": ("brand", "last4", "currency", "monthly_limit"),
    "address": ("line1", "line2", "city", "state", "postal_code", "country"),
    "phone": ("number",),
    "agent_item": ("service", "url", "username"),
}


def _model_view(item: dict) -> dict:
    keep = _MODEL_FIELDS.get(item["kind"], ())
    return {
        "id": item["id"],
        "kind": item["kind"],
        "name": item["label"],
        **{k: v for k, v in item["fields"].items() if k in keep},
    }


def register_vault_tools(
    tool_registry: Any,
    backend: D1Backend,
    user_id: str,
    create_pending_action: Callable[[dict], Awaitable[dict]] | None,
    computer_enabled: bool,
) -> None:
    async def vault_list(kind: str | None = None) -> str:
        items = await vault_d1.list_items(backend, user_id, kind or None)
        return json.dumps({"items": [_model_view(i) for i in items]})

    async def vault_request_payment(
        card_id: str,
        merchant: str,
        amount: float,
        currency: str | None = None,
        purpose: str | None = None,
    ) -> str:
        if create_pending_action is None:
            return json.dumps({"error": "payments need an approval surface"})
        try:
            result = await vault_d1.request_payment(
                backend,
                user_id,
                item_id=card_id,
                merchant=merchant,
                amount=amount,
                currency=currency,
                purpose=purpose,
                create_pending_action=create_pending_action,
            )
        except vault_d1.VaultError as exc:
            return json.dumps({"error": str(exc)})
        return json.dumps(result)

    async def vault_finish_payment(payment_id: str, succeeded: bool = True) -> str:
        status = "completed" if succeeded else "cancelled"
        ok = await vault_d1.set_payment_status(
            backend, user_id, payment_id, status, from_status="authorized"
        )
        if not ok:
            return json.dumps({"error": "payment is not in an authorized state"})
        return json.dumps({"ok": True, "status": status})

    async def vault_save_agent_account(
        service: str, username: str, password: str, url: str | None = None
    ) -> str:
        try:
            item = await vault_d1.create_item(
                backend,
                user_id,
                "agent_item",
                service,
                {"service": service, "username": username, "password": password, "url": url},
                owner="agent",
            )
        except vault_d1.VaultError as exc:
            return json.dumps({"error": str(exc)})
        return json.dumps({"ok": True, "id": item["id"]})

    tool_registry.register(
        name="vault_list",
        description=(
            "List the user's saved Vault items: logins, cards (brand/last4 only), addresses, "
            "phones and agent accounts. Returns ids you pass to other vault tools. "
            "Secrets are never returned."
        ),
        parameters={
            "type": "object",
            "properties": {"kind": {"type": "string", "enum": list(vault_d1.KINDS)}},
        },
        func=vault_list,
    )
    tool_registry.register(
        name="vault_request_payment",
        description=(
            "Ask the user to approve paying a merchant with a Vault card. Required before any "
            "checkout. After approval the card can be typed with vault_type for 15 minutes."
        ),
        parameters={
            "type": "object",
            "properties": {
                "card_id": {"type": "string"},
                "merchant": {"type": "string"},
                "amount": {"type": "number", "description": "Total in major units, e.g. 499.00"},
                "currency": {"type": "string", "description": "ISO code, defaults to the card's"},
                "purpose": {"type": "string"},
            },
            "required": ["card_id", "merchant", "amount"],
        },
        func=vault_request_payment,
    )
    tool_registry.register(
        name="vault_finish_payment",
        description="Record whether an approved payment went through, after checkout ends.",
        parameters={
            "type": "object",
            "properties": {
                "payment_id": {"type": "string"},
                "succeeded": {"type": "boolean"},
            },
            "required": ["payment_id"],
        },
        func=vault_finish_payment,
    )
    tool_registry.register(
        name="vault_save_agent_account",
        description=(
            "Save an account you created on the user's behalf (e.g. a sign-up during a task) "
            "to their Vault under Agent items."
        ),
        parameters={
            "type": "object",
            "properties": {
                "service": {"type": "string"},
                "username": {"type": "string"},
                "password": {"type": "string"},
                "url": {"type": "string"},
            },
            "required": ["service", "username", "password"],
        },
        func=vault_save_agent_account,
    )

    if not computer_enabled:
        return

    async def vault_type(item_id: str, field: str) -> str:
        import httpx

        from yomi.services.computer.client import ComputerClient

        try:
            value = await vault_d1.secret_for_typing(backend, user_id, item_id, field)
        except vault_d1.VaultError as exc:
            return json.dumps({"error": str(exc)})
        async with httpx.AsyncClient() as http:
            await ComputerClient.for_user(http, user_id).input({"action": "type", "text": value})
        return json.dumps({"ok": True, "typed": field, "characters": len(value)})

    tool_registry.register(
        name="vault_type",
        description=(
            "Type a Vault field into the currently focused input on the user's desktop "
            "(click the input first). Fields: login/agent_item username|password; card "
            "number|expiry|exp_month|exp_year|cvv|cardholder|billing_zip (card secrets need an "
            "approved payment); address line1|line2|city|state|postal_code|country; phone number."
        ),
        parameters={
            "type": "object",
            "properties": {"item_id": {"type": "string"}, "field": {"type": "string"}},
            "required": ["item_id", "field"],
        },
        func=vault_type,
    )
