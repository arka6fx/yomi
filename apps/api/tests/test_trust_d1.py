"""Trusted people over a real SQLite D1 schema."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from d1_sqlite import sqlite_backend

from yomi.services import actions_d1, trust_d1

A, B, C = "alice", "bob", "carol"


@pytest.fixture
def backend(monkeypatch):
    sent: list[tuple[str, str]] = []

    async def fake_send(chat_id: str, text: str) -> None:
        sent.append((chat_id, text))

    monkeypatch.setattr("yomi.gateway.telegram.send_message", fake_send)
    db = sqlite_backend(A, B, C)
    db.store.db.execute(
        "INSERT INTO platform_connections (user_id, platform, platform_user_id, platform_chat_id) "
        "VALUES (?, 'telegram', 'tg-bob', 'chat-bob')",
        [B],
    )
    db.sent = sent  # type: ignore[attr-defined]
    return db


async def _trust(backend, a: str, b: str) -> None:
    await trust_d1.request(backend, a, f"{b}@example.com")
    link = (await trust_d1.overview(backend, b))["requests"][0]
    await trust_d1.decide(backend, b, link["id"], "accept")


async def test_request_never_reveals_membership(backend):
    assert await trust_d1.request(backend, A, "nobody@example.com") == trust_d1.REQUEST_SENT
    assert await trust_d1.request(backend, A, "bob@example.com") == trust_d1.REQUEST_SENT
    assert (await trust_d1.overview(backend, B))["requests"][0]["name"] == "Alice"
    assert backend.sent and backend.sent[0][0] == "chat-bob"


async def test_accept_makes_trust_mutual(backend):
    await _trust(backend, A, B)
    assert [p["id"] for p in await trust_d1.trusted_people(backend, A)] == [B]
    assert [p["id"] for p in await trust_d1.trusted_people(backend, B)] == [A]


async def test_asking_back_accepts(backend):
    await trust_d1.request(backend, A, "bob@example.com")
    assert await trust_d1.request(backend, B, "alice@example.com") == "You now trust each other."


async def test_block_silently_drops_requests(backend):
    await _trust(backend, A, B)
    link = (await trust_d1.overview(backend, B))["trusted"][0]
    await trust_d1.decide(backend, B, link["id"], "block")
    assert await trust_d1.trusted_people(backend, A) == []
    assert await trust_d1.request(backend, A, "bob@example.com") == trust_d1.REQUEST_SENT
    overview = await trust_d1.overview(backend, B)
    assert overview["requests"] == [] and [p["personId"] for p in overview["blocked"]] == [A]
    with pytest.raises(trust_d1.TrustError, match="blocked"):
        await trust_d1.request(backend, B, "alice@example.com")


async def test_messages_need_trust_and_no_pause(backend):
    with pytest.raises(trust_d1.TrustError, match="both trust"):
        await trust_d1.send_message(backend, A, C, "hi")
    await _trust(backend, A, B)
    await trust_d1.set_paused(backend, B, True)
    with pytest.raises(trust_d1.TrustError, match="paused"):
        await trust_d1.send_message(backend, A, B, "hi")
    await trust_d1.set_paused(backend, B, False)
    await trust_d1.send_message(backend, A, B, "Free for lunch Friday?")
    inbox = await trust_d1.inbox(backend, B)
    assert inbox[0]["body"] == "Free for lunch Friday?" and inbox[0]["unread"]
    assert not (await trust_d1.inbox(backend, B))[0]["unread"]
    assert "Alice's Yomi" in backend.sent[-1][1]


async def test_approved_trust_message_is_delivered(backend):
    await _trust(backend, A, B)
    backend.store.db.execute(
        "INSERT INTO pending_actions (id, user_id, connector, action, risk, title, preview, "
        "payload, status, expires_at) VALUES ('act-1', ?, 'trust', 'trust-sendMessage', 'send', "
        "'Message Bob', 'hi', ?, 'pending', ?)",
        [A, '{"recipient_id": "bob", "body": "hi bob"}',
         (datetime.now(UTC) + timedelta(days=1)).isoformat()],
    )
    outcome = await actions_d1.decide(backend, A, "act-1", "approve")
    assert outcome["status"] == "executed"
    assert (await trust_d1.inbox(backend, B))[0]["body"] == "hi bob"
