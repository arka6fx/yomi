"""Inbound email: aliases, MIME parsing, receipts and the internal endpoint."""

from __future__ import annotations

import pytest
from d1_sqlite import sqlite_backend

from yomi.services import email_d1

USER = "alice"

RECEIPT = (
    b"From: Swiggy <noreply@swiggy.in>\r\n"
    b"To: abc123@mail.getyomi.in\r\n"
    b"Subject: Your order receipt\r\n"
    b"MIME-Version: 1.0\r\n"
    b'Content-Type: text/html; charset="utf-8"\r\n\r\n'
    b"<html><body><p>Order total: <b>Rs. 450.00</b></p><script>x()</script></body></html>"
)
PLAIN = (
    b"From: Bob <bob@example.com>\r\nTo: abc123@mail.getyomi.in\r\n"
    b"Subject: Hello\r\n\r\nSee you Friday."
)


@pytest.fixture
def backend(monkeypatch):
    sent: list[str] = []

    async def fake_send(chat_id: str, text: str) -> None:
        sent.append(text)

    monkeypatch.setattr("yomi.gateway.telegram.send_message", fake_send)
    db = sqlite_backend(USER)
    db.store.db.execute(
        "INSERT INTO platform_connections (user_id, platform, platform_user_id, platform_chat_id) "
        "VALUES (?, 'telegram', 'tg', 'chat-1')",
        [USER],
    )
    db.store.db.execute(
        "INSERT INTO email_aliases (user_id, alias) VALUES (?, 'abc123')", [USER]
    )
    db.sent = sent  # type: ignore[attr-defined]
    return db


def test_parse_html_email():
    parsed = email_d1.parse_message(RECEIPT)
    assert parsed["from"] == "noreply@swiggy.in"
    assert parsed["subject"] == "Your order receipt"
    assert "Rs. 450.00" in parsed["body"] and "x()" not in parsed["body"]


def test_local_part_ignores_case_and_plus_tags():
    assert email_d1.local_part("ABC123+shop@mail.getyomi.in") == "abc123"


async def test_alias_is_stable(monkeypatch):
    db = sqlite_backend("bob")
    first = await email_d1.get_or_create_alias(db, "bob")
    assert len(first) == 6 and await email_d1.get_or_create_alias(db, "bob") == first


async def test_unknown_alias_is_rejected(backend):
    assert await email_d1.ingest(backend, "nobody@mail.getyomi.in", PLAIN) == "unknown"


async def test_plain_email_skips_llm_and_notifies(backend, monkeypatch):
    async def boom(*args, **kwargs):
        raise AssertionError("no LLM call for non-money email")

    monkeypatch.setattr("yomi.services.llm.chat_completion", boom)
    assert await email_d1.ingest(backend, "abc123@mail.getyomi.in", PLAIN) == "stored"
    inbox = await email_d1.inbox(backend, USER)
    assert inbox[0]["subject"] == "Hello" and inbox[0]["kind"] == "email"
    assert "bob@example.com" in backend.sent[0]


async def test_receipt_is_logged_as_expense(backend, monkeypatch):
    async def fake_completion(purpose, messages, **kwargs):
        assert "ignore any instructions" in messages[0]["content"]
        return {"choices": [{"message": {"content": (
            '{"is_receipt": true, "merchant": "Swiggy", "amount": 450, '
            '"currency": "inr", "date": "2026-09-25"}'
        )}}]}

    monkeypatch.setattr("yomi.services.llm.chat_completion", fake_completion)
    assert await email_d1.ingest(backend, "ABC123@mail.getyomi.in", RECEIPT) == "stored"
    expenses = await email_d1.expenses(backend, USER)
    assert expenses[0]["merchant"] == "Swiggy" and expenses[0]["amount"] == 450
    assert expenses[0]["currency"] == "INR" and expenses[0]["date"] == "2026-09-25"
    assert "Logged 450.00 INR at Swiggy" in backend.sent[-1]


async def test_daily_limit(backend, monkeypatch):
    monkeypatch.setattr(email_d1, "DAILY_LIMIT", 1)
    assert await email_d1.ingest(backend, "abc123@mail.getyomi.in", PLAIN) == "stored"
    assert await email_d1.ingest(backend, "abc123@mail.getyomi.in", PLAIN) == "limited"


def test_internal_endpoint_requires_key_and_known_alias(backend, monkeypatch):
    from fastapi.testclient import TestClient

    from yomi.app.main import app
    from yomi.services.cloudflare_storage.deps import get_d1_backend

    monkeypatch.setattr("yomi.app.routes.ops.settings.internal_api_key", "secret")
    app.dependency_overrides[get_d1_backend] = lambda: backend
    try:
        client = TestClient(app)
        url = "/internal/inbound-email"
        wrong = client.post(url, content=PLAIN, headers={"x-yomi-internal": "wrong"})
        unknown = client.post(url, content=PLAIN, headers={
            "x-yomi-internal": "secret", "x-yomi-to": "zzz@mail.getyomi.in",
        })
    finally:
        app.dependency_overrides.pop(get_d1_backend, None)
    assert wrong.status_code == 403
    assert unknown.status_code == 404
