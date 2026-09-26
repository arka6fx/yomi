"""Vault + pending-action executor over a real SQLite database.

D1 is SQLite, so the fake store runs the actual ``migrations-d1`` files in an
in-memory database instead of pattern-matching SQL.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from d1_sqlite import sqlite_backend

from yomi.services import actions_d1, vault_d1
from yomi.services.cloudflare_storage.deps import D1Backend

USER = "user-1"
VISA = "4111 1111 1111 1111"


@pytest.fixture
def backend(monkeypatch) -> D1Backend:
    monkeypatch.setattr("yomi.crypto.settings.encryption_key", "a" * 64)
    monkeypatch.setattr("yomi.crypto.settings.encryption_key_fallbacks", "")
    return sqlite_backend(USER, "someone-else")


def _pending_hook(backend: D1Backend, captured: list[dict]):
    async def creator(meta: dict) -> dict:
        action_id = f"act-{len(captured) + 1}"
        captured.append(meta)
        await backend.store.atomic([
            backend.store.insert("pending_actions", {
                "id": action_id,
                "user_id": USER,
                "connector": meta["connector"],
                "action": meta["action"],
                "risk": meta["risk"],
                "title": meta["title"],
                "preview": meta["preview"],
                "confirm_text": meta.get("confirm_text"),
                "payload": meta["payload"],
                "status": "pending",
                "expires_at": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
            })
        ])
        return {"id": action_id, "status": "pending"}

    return creator


async def _card(backend: D1Backend, **extra: Any) -> dict:
    fields = {"number": VISA, "exp_month": "7", "exp_year": "2029", "cvv": "123", **extra}
    return await vault_d1.create_item(backend, USER, "card", "Travel card", fields)


def test_card_validation():
    with pytest.raises(vault_d1.VaultError, match="not valid"):
        vault_d1.normalize_item("card", "x", {"number": "4111111111111112", "exp_month": "1",
                                              "exp_year": "30", "cvv": "123"})
    public, secret = vault_d1.normalize_item(
        "card", "x", {"number": VISA, "exp_month": "7", "exp_year": "2029", "cvv": "123"}
    )
    assert public["brand"] == "Visa" and public["last4"] == "1111"
    assert public["exp_month"] == "07" and public["exp_year"] == "29"
    assert secret == {"number": "4111111111111111", "cvv": "123"}


async def test_secrets_are_encrypted_and_never_listed(backend):
    card = await _card(backend)
    raw = await backend.store.fetch_one("SELECT * FROM vault_items WHERE id = ?", [card["id"]])
    assert VISA.replace(" ", "") not in json.dumps(raw)
    # The random id and timestamps are left out: they can contain "123" by chance.
    listed = json.dumps([
        {k: v for k, v in item.items() if k != "id" and not k.endswith("At")}
        for item in await vault_d1.list_items(backend, USER)
    ])
    assert "4111111111111111" not in listed and "123" not in listed


async def test_login_password_types_without_approval(backend):
    login = await vault_d1.create_item(
        backend, USER, "login", "GitHub", {"username": "me", "password": "hunter2"}
    )
    assert await vault_d1.secret_for_typing(backend, USER, login["id"], "password") == "hunter2"


async def test_card_number_needs_approved_payment(backend):
    card = await _card(backend)
    with pytest.raises(vault_d1.VaultError, match="no approved payment"):
        await vault_d1.secret_for_typing(backend, USER, card["id"], "number")

    captured: list[dict] = []
    result = await vault_d1.request_payment(
        backend, USER, item_id=card["id"], merchant="IRCTC", amount=1250.5,
        currency=None, purpose="Train", create_pending_action=_pending_hook(backend, captured),
    )
    assert captured[0]["risk"] == "paid" and "1250.50 INR" in captured[0]["title"]

    outcome = await actions_d1.decide(backend, USER, result["id"], "approve")
    assert outcome["status"] == "executed"
    number = await vault_d1.secret_for_typing(backend, USER, card["id"], "number")
    assert number == "4111111111111111"
    assert await vault_d1.secret_for_typing(backend, USER, card["id"], "expiry") == "07/29"

    ledger = await vault_d1.list_payments(backend, USER)
    assert ledger["monthTotals"] == {"INR": 1250.5}


async def test_monthly_limit_blocks_request(backend):
    card = await _card(backend, monthly_limit="1000")
    hook = _pending_hook(backend, [])
    first = await vault_d1.request_payment(
        backend, USER, item_id=card["id"], merchant="A", amount=800, currency=None,
        purpose=None, create_pending_action=hook,
    )
    await actions_d1.decide(backend, USER, first["id"], "approve")
    with pytest.raises(vault_d1.VaultError, match="monthly limit"):
        await vault_d1.request_payment(
            backend, USER, item_id=card["id"], merchant="B", amount=300, currency=None,
            purpose=None, create_pending_action=hook,
        )


async def test_reject_marks_payment_and_blocks_double_decide(backend):
    card = await _card(backend)
    pending = await vault_d1.request_payment(
        backend, USER, item_id=card["id"], merchant="A", amount=10, currency=None,
        purpose=None, create_pending_action=_pending_hook(backend, []),
    )
    outcome = await actions_d1.decide(backend, USER, pending["id"], "reject")
    assert outcome["status"] == "rejected"
    ledger = await vault_d1.list_payments(backend, USER)
    assert ledger["payments"][0]["status"] == "rejected"
    with pytest.raises(actions_d1.ActionNotFound):
        await actions_d1.decide(backend, USER, pending["id"], "approve")


async def test_other_users_cannot_decide(backend):
    card = await _card(backend)
    pending = await vault_d1.request_payment(
        backend, USER, item_id=card["id"], merchant="A", amount=10, currency=None,
        purpose=None, create_pending_action=_pending_hook(backend, []),
    )
    with pytest.raises(actions_d1.ActionNotFound):
        await actions_d1.decide(backend, "someone-else", pending["id"], "approve")


async def test_connector_action_is_replayed(backend, monkeypatch):
    calls: list[tuple[str, dict]] = []

    class Registry:
        async def execute(self, name: str, **kwargs):
            calls.append((name, kwargs))
            return {"ok": True}

    async def fake_build(db, user_id, hook, d1=None):
        assert hook is None  # replay must bypass the approval gate
        return Registry()

    monkeypatch.setattr("yomi.services.agent.tools.build_user_registry", fake_build)
    hook = _pending_hook(backend, [])
    pending = await hook({
        "connector": "google", "action": "gmail-sendEmail", "risk": "send",
        "title": "Send email", "preview": "hi", "payload": {"to": "a@b.c", "body": "hi"},
    })
    outcome = await actions_d1.decide(backend, USER, pending["id"], "approve")
    assert outcome["status"] == "executed"
    assert calls == [("gmail-sendEmail", {"to": "a@b.c", "body": "hi"})]
    row = await backend.store.fetch_one("SELECT status FROM pending_actions WHERE id = ?",
                                        [pending["id"]])
    assert row["status"] == "executed"
