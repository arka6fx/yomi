"""Take-over viewer links and saving logins on the user's private computer."""

from __future__ import annotations

import hashlib
import hmac
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

SECRET = "s" * 40


@pytest.fixture
def http(monkeypatch):
    from yomi.app.deps import get_current_user
    from yomi.app.main import app

    monkeypatch.setattr("yomi.conf.settings.computer_gateway_url", "https://computer.example.test")
    monkeypatch.setattr("yomi.conf.settings.computer_gateway_secret", SECRET)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="User_1")
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_viewer_token_matches_the_gateway_check():
    from yomi.app.routes import computer

    token, exp = "", 0
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("yomi.conf.settings.computer_gateway_secret", SECRET)
        token, exp = computer.viewer_token("User_1", now=1_000)
    expected = hmac.new(SECRET.encode(), f"User_1.{exp}".encode(), hashlib.sha256).hexdigest()
    assert exp == 1_000 + computer.VIEWER_TTL_S and token == f"{exp}.{expected}"


def test_viewer_url_is_a_signed_websocket_for_this_user(http):
    body = http.post("/api/computer/viewer").json()
    assert body["url"].startswith("wss://computer.example.test/computer/User_1/vnc?token=")
    assert http.get("/api/computer").json() == {
        "available": True, "pageUrl": "https://getyomi.in/dashboard?tab=computer",
    }


def test_save_calls_the_gateway(http, monkeypatch):
    calls: list[str] = []

    async def fake_post(self, action, payload):
        calls.append(f"{self.workspace}:{action}")
        return {"saved": True}

    monkeypatch.setattr("yomi.services.computer.client.ComputerClient._post", fake_post)
    assert http.post("/api/computer/save").json() == {"saved": True}
    assert calls == ["User_1:save"]


def test_unconfigured_computer_says_so(http, monkeypatch):
    monkeypatch.setattr("yomi.conf.settings.computer_gateway_url", "")
    assert http.post("/api/computer/viewer").status_code == 503
    assert http.get("/api/computer").json()["available"] is False


def test_wake_returns_at_once_and_boots_in_background(http, monkeypatch):
    calls: list[str] = []

    async def fake_post(self, action, payload):
        calls.append(action)
        return {"ok": True}

    monkeypatch.setattr("yomi.services.computer.client.ComputerClient._post", fake_post)
    assert http.post("/api/computer/wake").json() == {"waking": True}
