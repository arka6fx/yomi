"""Linking Telegram folds a Telegram-only placeholder account into the linking account."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from d1_sqlite import sqlite_backend

from yomi.services import account_merge_d1, characters_d1, connectors_d1

GOOGLE = "google-user"
TG = "tg-user"
TG_ID = "6239907768"


@pytest.fixture
def backend(monkeypatch):
    async def no_embed(_text):
        return []

    monkeypatch.setattr("yomi.services.memory.embeddings.embed_memory_text", no_embed)
    db = sqlite_backend(GOOGLE, TG)
    sql = db.store.db
    sql.execute("PRAGMA foreign_keys = ON")
    sql.execute(
        'UPDATE "user" SET email = ? WHERE id = ?', [f"telegram-{TG_ID}@users.getyomi.in", TG]
    )
    sql.execute(
        "INSERT INTO platform_connections (id, user_id, platform, platform_user_id, "
        "platform_chat_id, connected_at, updated_at) "
        "VALUES ('pc1', ?, 'telegram', ?, ?, 'now', 'now')",
        [TG, TG_ID, TG_ID],
    )
    return db


def _token(db, user_id: str) -> str:
    expires = (datetime.now(UTC) + timedelta(minutes=5)).isoformat()
    db.store.db.execute(
        "INSERT INTO telegram_link_tokens (token, user_id, expires_at) VALUES ('tok', ?, ?)",
        [user_id, expires],
    )
    return "tok"


def _count(db, sql: str, params: list) -> int:
    return db.store.db.execute(sql, params).fetchone()[0]


async def test_linking_moves_data_and_removes_the_placeholder(backend):
    await characters_d1.activate(backend, TG, "gallery:satoru-gojo")
    made = await characters_d1.create(
        backend, TG, {"name": "Luna", "personality": "calm", "firstLines": ["hi"]}
    )
    backend.store.db.execute(
        "INSERT INTO schedules (id, user_id, schedule, schedule_type, prompt, enabled, "
        "created_at, updated_at) "
        "VALUES ('s1', ?, 'every day at 8am', 'cron', 'brief', 1, 'now', 'now')",
        [TG],
    )

    await connectors_d1.link_with_code(backend, "telegram", TG_ID, TG_ID, _token(backend, GOOGLE))

    assert await connectors_d1.resolve_platform_user(backend, "telegram", TG_ID, TG_ID) == GOOGLE
    assert (await characters_d1.active(backend, GOOGLE))["name"] == "Satoru Gojo"
    assert any(c["id"] == made["id"] for c in await characters_d1.list_mine(backend, GOOGLE))
    assert _count(backend, "SELECT count(*) FROM schedules WHERE user_id = ?", [GOOGLE]) == 1
    assert _count(backend, 'SELECT count(*) FROM "user" WHERE id = ?', [TG]) == 0


async def test_target_keeps_its_own_row_on_conflict(backend):
    await characters_d1.activate(backend, TG, "gallery:zen")
    await characters_d1.activate(backend, GOOGLE, "gallery:satoru-gojo")
    assert await account_merge_d1.merge_placeholder(backend, TG, GOOGLE)
    assert (await characters_d1.active(backend, GOOGLE))["name"] == "Satoru Gojo"


async def test_real_accounts_are_never_merged(backend):
    backend.store.db.execute(
        "INSERT INTO account (id, account_id, provider_id, user_id, created_at, updated_at) "
        "VALUES ('a1', 'g1', 'google', ?, 'now', 'now')",
        [TG],
    )
    assert not await account_merge_d1.is_placeholder(backend, TG)
    assert not await account_merge_d1.merge_placeholder(backend, TG, GOOGLE)
    assert not await account_merge_d1.is_placeholder(backend, GOOGLE)
    assert _count(backend, 'SELECT count(*) FROM "user" WHERE id = ?', [TG]) == 1
