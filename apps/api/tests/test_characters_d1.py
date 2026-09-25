"""Characters over the real SQLite D1 schema."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from d1_sqlite import sqlite_backend
from fastapi.testclient import TestClient

from yomi.services import characters_d1

USER = "alice"
GOJO = "gallery:satoru-gojo"
MINE = {
    "name": "Captain Test",
    "emoji": "🧪",
    "personality": "cheerful and brief",
    "tagline": "testing, testing",
    "firstLines": ["ahoy!", "", "second line"],
    "tags": ["roleplay", "not-a-tag"],
}


@pytest.fixture
def backend():
    db = sqlite_backend(USER)
    db.store.db.execute(
        "INSERT INTO platform_connections (user_id, platform, platform_user_id, platform_chat_id) "
        "VALUES (?, 'telegram', 'tg', 'chat-1')",
        [USER],
    )
    return db


def test_gallery_has_featured_fan_characters_with_credit():
    gojo = characters_d1.gallery_character(GOJO)
    assert gojo["featured"] and gojo["basedOn"] == "Satoru Gojo (Jujutsu Kaisen)"
    assert gojo["imageUrl"].startswith("https://") and gojo["imageCredit"] == "TVMaze"
    assert all(c["firstLines"] for c in characters_d1.gallery())


async def test_create_validates_and_cleans(backend):
    made = await characters_d1.create(backend, USER, MINE)
    assert made["firstLines"] == ["ahoy!", "second line"] and made["tags"] == ["roleplay"]
    with pytest.raises(characters_d1.CharacterError, match="first line"):
        await characters_d1.create(backend, USER, {**MINE, "firstLines": [""]})
    with pytest.raises(characters_d1.CharacterError, match="https"):
        await characters_d1.create(backend, USER, {**MINE, "imageUrl": "http://x/y.png"})
    with pytest.raises(characters_d1.CharacterError, match="minors"):
        await characters_d1.create(
            backend, USER, {**MINE, "description": "an explicit schoolgirl"}
        )
    with pytest.raises(characters_d1.CharacterError, match="Yomi team"):
        await characters_d1.create(backend, USER, {**MINE, "name": "Yomi Support"})


async def test_activate_persona_and_back(backend):
    await characters_d1.activate(backend, USER, GOJO)
    active = await characters_d1.active(backend, USER)
    assert active["name"] == "Satoru Gojo"
    assert await characters_d1.saved_ids(backend, USER) == [GOJO]
    prompt = characters_d1.persona_prompt(active)
    assert "Satoru Gojo" in prompt and "fan-made" in prompt and "AI character" in prompt
    assert await characters_d1.deactivate(backend, USER)
    assert await characters_d1.active(backend, USER) is None


async def test_deleting_the_active_character_returns_to_yomi(backend):
    made = await characters_d1.create(backend, USER, MINE)
    await characters_d1.activate(backend, USER, made["id"])
    assert await characters_d1.delete(backend, USER, made["id"])
    assert await characters_d1.active(backend, USER) is None


async def test_find_by_name_is_forgiving(backend):
    assert (await characters_d1.find_by_name(backend, USER, "gojo"))["id"] == GOJO
    assert await characters_d1.find_by_name(backend, USER, "nobody at all") is None


async def test_system_prompt_includes_active_persona(backend):
    from yomi.services.agent.loop import _system_prompt

    assert "active_character" not in await _system_prompt(None, backend, USER)
    await characters_d1.activate(backend, USER, GOJO)
    assert "<active_character" in await _system_prompt(None, backend, USER)


def test_activate_route_texts_first(backend, monkeypatch):
    from yomi.app.deps import get_current_user
    from yomi.app.main import app
    from yomi.services.cloudflare_storage.deps import get_d1_backend

    sent: list[tuple[str, str]] = []

    async def fake_send(chat_id, text):
        sent.append((chat_id, text))

    monkeypatch.setattr("yomi.gateway.telegram.send_message", fake_send)
    app.dependency_overrides[get_d1_backend] = lambda: backend
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
        id=USER, email="a@example.com", role="user", plan="explore"
    )
    try:
        http = TestClient(app)
        listed = http.get("/api/characters").json()
        assert any(c["id"] == GOJO for c in listed["gallery"]) and listed["active"] is None
        ok = http.post(f"/api/characters/{GOJO}/activate").json()
        assert ok["textedYou"] and ok["active"]["name"] == "Satoru Gojo"
        assert sent[-1][0] == "chat-1" and "Satoru Gojo" in sent[-1][1]
        assert http.post("/api/characters/active/clear").json() == {"active": None}
        assert "back to plain yomi" in sent[-1][1]
    finally:
        app.dependency_overrides.clear()


async def test_linking_telegram_later_gets_the_first_text(backend, monkeypatch):
    from yomi.gateway import telegram

    sent: list[tuple[str, str]] = []

    async def fake_send(chat_id, text):
        sent.append((chat_id, text))

    monkeypatch.setattr(telegram, "send_message", fake_send)
    await characters_d1.activate(backend, USER, GOJO)
    await telegram._greet_as_active_character(backend, "tg", "chat-1")
    assert sent and sent[-1][0] == "chat-1" and "Satoru Gojo" in sent[-1][1]


def test_gallery_is_gojo_and_hello_kitty():
    assert [c["name"] for c in characters_d1.gallery()] == ["Satoru Gojo", "Hello Kitty"]
    kitty = characters_d1.gallery_character("gallery:hello-kitty")
    assert kitty["basedOn"] == "Hello Kitty (Sanrio)" and kitty["imageCredit"] == "AniList"
