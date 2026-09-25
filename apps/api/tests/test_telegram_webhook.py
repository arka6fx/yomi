"""Startup check that the Telegram webhook receives button taps."""

from __future__ import annotations

import pytest

from yomi.gateway import telegram


class FakeClient:
    def __init__(self, allowed):
        self.allowed = allowed
        self.posts: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url):
        allowed = self.allowed

        class R:
            def json(self):
                return {
                    "result": {"url": "https://api.getyomi.in/hook", "allowed_updates": allowed}
                }

        return R()

    async def post(self, url, json):
        self.posts.append(json)


@pytest.mark.parametrize(
    ("allowed", "expected"),
    [
        (["message"], ["callback_query", "message"]),
        (["message", "callback_query"], None),
        ([], None),  # Telegram's default already includes both
    ],
)
async def test_webhook_gets_callback_queries(monkeypatch, allowed, expected):
    client = FakeClient(allowed)
    monkeypatch.setattr(telegram.settings, "telegram_bot_token", "t")
    monkeypatch.setattr(telegram.settings, "telegram_webhook_secret", "")
    monkeypatch.setattr(telegram.httpx, "AsyncClient", lambda **kwargs: client)
    assert await telegram.ensure_webhook_updates() == expected
    if expected:
        assert client.posts == [{"url": "https://api.getyomi.in/hook", "allowed_updates": expected}]
    else:
        assert client.posts == []
