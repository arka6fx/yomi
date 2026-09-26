"""Only Telegram can post updates: forged ones would let anyone act as any user."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

SECRET = "s3cret-" + "x" * 30
TOKEN = "123:abc"


@pytest.fixture
def http(monkeypatch):
    from yomi.app.main import app
    from yomi.gateway import telegram

    handled: list[dict] = []

    async def fake_handle(update, db_session, d1):
        handled.append(update)
        return {"status": "ok"}

    from yomi.app.deps import get_db_session
    from yomi.services.cloudflare_storage.deps import get_d1_backend

    async def no_db():
        yield None

    monkeypatch.setattr(telegram, "_handle_update", fake_handle)
    monkeypatch.setattr(telegram.settings, "telegram_bot_token", TOKEN)
    # Storage isn't what's under test: authentication happens before it's used.
    app.dependency_overrides[get_db_session] = no_db
    app.dependency_overrides[get_d1_backend] = no_db
    client = TestClient(app)
    client.handled = handled
    yield client
    app.dependency_overrides.clear()


def test_forged_update_is_rejected_when_no_secret_is_set(http, monkeypatch):
    from yomi.gateway import telegram

    monkeypatch.setattr(telegram.settings, "telegram_webhook_secret", "")
    res = http.post("/api/gateway/telegram", json={"update_id": 1})
    assert res.status_code == 403 and http.handled == []  # fails closed


def test_secret_header_is_required_and_checked(http, monkeypatch):
    from yomi.gateway import telegram

    monkeypatch.setattr(telegram.settings, "telegram_webhook_secret", SECRET)
    assert http.post("/api/gateway/telegram", json={"update_id": 1}).status_code == 403
    wrong = {"X-Telegram-Bot-Api-Secret-Token": SECRET + "x"}
    assert http.post("/api/gateway/telegram", json={}, headers=wrong).status_code == 403
    right = {"X-Telegram-Bot-Api-Secret-Token": SECRET}
    assert http.post("/api/gateway/telegram", json={"update_id": 2}, headers=right).json() == {
        "status": "ok"
    }
    assert [u["update_id"] for u in http.handled] == [2]


def test_legacy_token_url_needs_the_right_token_and_the_secret_once_set(http, monkeypatch):
    from yomi.gateway import telegram

    monkeypatch.setattr(telegram.settings, "telegram_webhook_secret", "")
    assert http.post("/api/gateway/telegram/webhook/999:nope", json={}).status_code == 404
    assert http.post(f"/api/gateway/telegram/webhook/{TOKEN}", json={"update_id": 3}).json() == {
        "status": "ok"
    }
    monkeypatch.setattr(telegram.settings, "telegram_webhook_secret", SECRET)
    res = http.post(f"/api/gateway/telegram/webhook/{TOKEN}", json={"update_id": 4})
    assert res.status_code == 403  # once a secret exists, the token alone isn't enough
