"""Web sign-in with Telegram over a real SQLite D1 schema."""

from __future__ import annotations

import pytest
from d1_sqlite import sqlite_backend
from fastapi.testclient import TestClient

from yomi.services import telegram_login_d1

TG_USER = {"id": 424242, "first_name": "Arka", "last_name": "G", "username": "arka"}


@pytest.fixture
def backend(monkeypatch):
    async def no_grant(*args, **kwargs):
        return None

    monkeypatch.setattr("yomi.app.routes.auth._apply_signup_side_effects_d1", no_grant)
    return sqlite_backend()


async def test_request_is_single_use_and_bound_to_the_approver(backend):
    from yomi.app.routes.auth import telegram_account_for

    started = await telegram_login_d1.start(backend, "Mozilla/5.0 (Windows) Chrome/140", "1.2.3.4")
    assert len(started["code"]) == 4
    assert await telegram_login_d1.consume(backend, started["token"]) == ("pending", None)

    user_id = await telegram_account_for(backend, TG_USER)
    assert await telegram_login_d1.decide(backend, started["token"], user_id, approve=True)
    assert not await telegram_login_d1.decide(backend, started["token"], user_id, approve=True)
    assert await telegram_login_d1.consume(backend, started["token"]) == ("approved", user_id)
    assert (await telegram_login_d1.consume(backend, started["token"]))[0] == "consumed"


async def test_account_is_created_once_and_linked(backend):
    from yomi.app.routes.auth import telegram_account_for

    first = await telegram_account_for(backend, TG_USER)
    assert await telegram_account_for(backend, TG_USER) == first
    user = await backend.store.fetch_one('SELECT name, email FROM "user" WHERE id = ?', [first])
    assert user["name"] == "Arka G" and user["email"] == "telegram-424242@users.getyomi.in"
    link = await backend.store.fetch_one(
        "SELECT platform_chat_id FROM platform_connections WHERE user_id = ?", [first]
    )
    assert link["platform_chat_id"] == "424242"


async def test_cancel_and_expiry(backend):
    started = await telegram_login_d1.start(backend, "", "")
    assert await telegram_login_d1.decide(backend, started["token"], None, approve=False)
    assert (await telegram_login_d1.consume(backend, started["token"]))[0] == "cancelled"

    other = await telegram_login_d1.start(backend, "", "")
    backend.store.db.execute(
        "UPDATE telegram_login_requests SET expires_at = '2000-01-01' WHERE token = ?",
        [other["token"]],
    )
    assert await telegram_login_d1.pending(backend, other["token"]) is None
    assert (await telegram_login_d1.consume(backend, other["token"]))[0] == "expired"


def test_describe_device():
    ua = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/140.0 Safari/537.36"
    assert telegram_login_d1.describe_device(ua) == "Chrome on Windows"


def test_poll_sets_session_cookie_once(backend, monkeypatch):
    import asyncio

    from yomi.app.main import app
    from yomi.app.routes.auth import telegram_account_for
    from yomi.services.cloudflare_storage.deps import get_d1_backend

    monkeypatch.setattr("yomi.app.routes.auth.settings.telegram_bot_username", "yomibot")
    app.dependency_overrides[get_d1_backend] = lambda: backend
    try:
        client = TestClient(app)
        started = client.post("/api/auth/telegram-login/start").json()
        assert started["url"] == f"https://t.me/yomibot?start=login_{started['token']}"
        assert client.post(
            "/api/auth/telegram-login/poll", json={"token": started["token"]}
        ).json() == {"status": "pending"}

        async def approve():
            user_id = await telegram_account_for(backend, TG_USER)
            await telegram_login_d1.decide(backend, started["token"], user_id, approve=True)

        asyncio.run(approve())
        ok = client.post("/api/auth/telegram-login/poll", json={"token": started["token"]})
        assert ok.json() == {"status": "approved"} and "set-cookie" in ok.headers
        again = client.post("/api/auth/telegram-login/poll", json={"token": started["token"]})
        assert again.json() == {"status": "consumed"} and "set-cookie" not in again.headers
    finally:
        app.dependency_overrides.pop(get_d1_backend, None)
