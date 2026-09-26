"""Gateway port tests: route wiring for the Telegram link flow.

Follows the repo convention of DB-free tests: unauthenticated requests must
reach the routes (401, not 404) so a missing endpoint can't masquerade as a
silent auth failure. Heavy DB paths are covered by production verification.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from yomi.app.main import create_app
from yomi.db_session import get_db_session


@pytest.fixture
def no_db_client():
    app = create_app()

    async def _fake_db():
        yield object()

    app.dependency_overrides[get_db_session] = _fake_db
    with TestClient(app) as client:
        yield client


def test_connections_requires_auth(no_db_client: TestClient):
    res = no_db_client.get("/api/gateway/connections")
    assert res.status_code == 401


def test_telegram_token_requires_auth(no_db_client: TestClient):
    res = no_db_client.post("/api/gateway/telegram/token")
    assert res.status_code == 401


def test_telegram_markdown_is_rendered_as_html():
    from yomi.gateway.telegram import _markdown_to_telegram_html

    rendered = _markdown_to_telegram_html(
        "## Hello\n\n**bold** and *italic* with [a link](https://example.com)"
    )
    assert "<b>Hello</b>" in rendered
    assert "<b>bold</b>" in rendered
    assert "<i>italic</i>" in rendered
    assert '<a href="https://example.com">a link</a>' in rendered
    assert "**" not in rendered


def test_telegram_markdown_drops_unmatched_emphasis_markers():
    from yomi.gateway.telegram import _markdown_to_telegram_html

    rendered = _markdown_to_telegram_html("**Starting now\nA clean reply")
    assert "**" not in rendered
    assert "Starting now" in rendered


def test_unlink_requires_auth(no_db_client: TestClient):
    res = no_db_client.delete("/api/gateway/connections/telegram")
    assert res.status_code == 401


def test_gateway_status_public(no_db_client: TestClient):
    res = no_db_client.get("/api/gateway/status")
    assert res.status_code == 200
    assert res.json()["running"] is True


def test_markdown_tables_become_phone_friendly_lists():
    from yomi.gateway.telegram import _markdown_to_telegram_html

    table = (
        "top picks:\n\n"
        "| # | Product | Price | Rating | Notes |\n"
        "|---|---------|-------|--------|-------|\n"
        "| 1 | **Airdopes 300** | **₹1,299** | 3.9⭐ "
        "| 50H battery, spatial audio, 4-mic ENx, IPX4 |\n"
        "| 2 | Airdopes 224 | ₹999 | 3.8⭐ | cheapest |\n"
        "\nwant me to add one to cart?"
    )
    rendered = _markdown_to_telegram_html(table)
    assert "|" not in rendered and "---" not in rendered
    assert "1. <b>Airdopes 300</b>\n   Price: <b>₹1,299</b> · Rating: 3.9⭐\n" in rendered
    assert "   Notes: 50H battery, spatial audio, 4-mic ENx, IPX4" in rendered
    assert "2. Airdopes 224\n   Price: ₹999 · Rating: 3.8⭐ · Notes: cheapest" in rendered
    assert rendered.endswith("want me to add one to cart?")
