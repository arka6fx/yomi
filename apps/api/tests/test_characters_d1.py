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


def test_gallery_is_complete_and_safe():
    gallery = characters_d1.gallery()
    names = [c["name"] for c in gallery]
    assert names[:3] == ["Satoru Gojo", "Hello Kitty", "Ghost"] and len(names) == 232
    assert len({c["id"] for c in gallery}) == len(gallery)  # unique slugs
    assert sum("genshin" in c["tags"] for c in gallery) == 9
    for c in gallery:
        assert c["basedOn"] and c["tagline"] and c["description"] and c["personality"], c["name"]
        assert c["firstLines"] and len(c["starters"]) == 4, c["name"]
        assert len(c["tagline"]) <= characters_d1.LIMITS["tagline"], c["name"]
        assert 1 <= len(c["tags"]) <= characters_d1.MAX_TAGS, c["name"]
        assert set(c["tags"]) <= set(characters_d1.TAGS), c["name"]
        sources = ("https://s4.anilist.co/", "https://static.tvmaze.com/",
                   "https://static.wikia.nocookie.net/")
        assert c["imageUrl"].startswith(sources) and c["imageCredit"], c["name"]
        assert "no romance" in c["personality"] or c["id"] == "gallery:satoru-gojo", c["name"]
        # the hard lines apply to built-in characters too
        characters_d1.check_allowed(" ".join([c["name"], c["description"], c["personality"]]))
    kitty = characters_d1.gallery_character("gallery:hello-kitty")
    assert kitty["basedOn"] == "Hello Kitty (Sanrio)" and kitty["imageCredit"] == "AniList"


async def test_switches_default_on_and_are_per_character(backend):
    made = await characters_d1.create(backend, USER, MINE)
    assert made["textsFirst"] and made["usesTools"]
    updated = await characters_d1.set_settings(backend, USER, GOJO, {"usesTools": False})
    assert updated["textsFirst"] and not updated["usesTools"]
    assert not (await characters_d1.get(backend, USER, GOJO))["usesTools"]
    assert (await characters_d1.get(backend, USER, made["id"]))["usesTools"]
    await characters_d1.activate(backend, USER, GOJO)
    assert not (await characters_d1.active(backend, USER))["usesTools"]  # read in one trip
    with pytest.raises(characters_d1.CharacterError):
        await characters_d1.set_settings(backend, USER, "nope", {"textsFirst": False})


async def test_based_on_characters_need_no_personality(backend):
    with pytest.raises(characters_d1.CharacterError, match="how they talk"):
        await characters_d1.create(backend, USER, {**MINE, "personality": ""})
    made = await characters_d1.create(
        backend, USER, {**MINE, "personality": "", "basedOn": "Nami (One Piece)"}
    )
    prompt = characters_d1.persona_prompt(made)
    assert "Play them as they are in Nami (One Piece)" in prompt
    assert "Personality and voice" not in prompt


def test_talk_only_prompt_says_there_are_no_tools():
    gojo = characters_d1.gallery_character(GOJO)
    assert "every Yomi tool" in characters_d1.persona_prompt(gojo)
    talk_only = characters_d1.persona_prompt({**gojo, "usesTools": False})
    assert "every Yomi tool" not in talk_only and "you have no tools" in talk_only


async def test_talk_only_character_gets_no_tools_but_can_go_back(backend, monkeypatch):
    from yomi.services.agent import loop

    offered: list = []

    class FakeRegistry:
        def get_openai_tools(self):
            return [{"type": "function", "function": {"name": n}}
                    for n in ("web_search", "character_exit")]

        async def execute(self, name, **args):
            return {"ran": name}

    replies = iter([
        {"choices": [{"message": {"role": "assistant", "tool_calls": [
            {"id": "1", "function": {"name": "web_search", "arguments": "{}"}}]}}]},
        {"choices": [{"message": {"role": "assistant", "content": "just talking"}}]},
    ])

    async def fake_completion(purpose, messages, tools=None, **kwargs):
        offered.append([t["function"]["name"] for t in tools or []])
        return next(replies)

    async def fake_registry(*args):
        return FakeRegistry()

    async def no_charge(*args):
        return None

    monkeypatch.setattr(loop, "chat_completion", fake_completion)
    monkeypatch.setattr(loop, "build_user_registry", fake_registry)
    monkeypatch.setattr(loop, "_charge_composio_usage", no_charge)
    await characters_d1.activate(backend, USER, GOJO)
    await characters_d1.set_settings(backend, USER, GOJO, {"usesTools": False})
    history = [{"role": "user", "content": "search the web"}]
    assert await loop.run_agent_loop(history, USER, "explore", d1=backend) == "just talking"
    assert offered[0] == ["character_exit"]


def test_texts_first_off_means_no_opening_text(backend, monkeypatch):
    from yomi.app.deps import get_current_user
    from yomi.app.main import app
    from yomi.services.cloudflare_storage.deps import get_d1_backend

    sent: list = []

    async def fake_send(chat_id, text):
        sent.append(text)

    monkeypatch.setattr("yomi.gateway.telegram.send_message", fake_send)
    app.dependency_overrides[get_d1_backend] = lambda: backend
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
        id=USER, email="a@example.com", role="user", plan="explore"
    )
    try:
        http = TestClient(app)
        res = http.post(f"/api/characters/{GOJO}/settings", json={"textsFirst": False})
        assert res.status_code == 200 and res.json()["character"]["textsFirst"] is False
        listed = http.get("/api/characters").json()
        assert next(c for c in listed["gallery"] if c["id"] == GOJO)["textsFirst"] is False
        assert http.post(f"/api/characters/{GOJO}/activate").json()["textedYou"] is False
        assert sent == []
    finally:
        app.dependency_overrides.clear()


async def test_shared_character_link_switches_the_chat(backend, monkeypatch):
    from yomi.gateway import telegram

    sent: list[tuple[str, str]] = []

    async def fake_send(chat_id, text):
        sent.append((chat_id, text))

    monkeypatch.setattr(telegram, "send_message", fake_send)
    await characters_d1.set_settings(backend, USER, GOJO, {"textsFirst": False})
    await telegram._start_shared_character(backend, "tg", "chat-1", "satoru-gojo")
    assert (await characters_d1.active(backend, USER))["id"] == GOJO
    assert "Satoru Gojo" in sent[-1][1]  # says hello even with texts-first off
    await telegram._start_shared_character(backend, "tg", "chat-1", "nobody")
    assert "isn't available" in sent[-1][1]
    await telegram._start_shared_character(backend, "stranger", "chat-9", "satoru-gojo")
    assert "Link your Yomi account" in sent[-1][1]


async def test_gallery_counts_chats_this_week_and_likes(backend):
    backend.store.db.execute(
        "INSERT INTO \"user\" (id, name, email, created_at, updated_at) "
        "VALUES ('bob', 'Bob', 'bob@example.com', 'now', 'now')"
    )
    await characters_d1.activate(backend, USER, GOJO)
    await characters_d1.activate(backend, "bob", GOJO)
    backend.store.db.execute(  # an old chat counts in total, not this week
        "INSERT INTO character_chats (id, user_id, character_id, created_at) "
        "VALUES ('old', 'bob', ?, '2020-01-01T00:00:00+00:00')",
        [GOJO],
    )
    await characters_d1.set_liked(backend, "bob", GOJO, True)
    await characters_d1.set_liked(backend, "bob", GOJO, True)  # one like per person
    stats = await characters_d1.gallery_stats(backend, USER)
    assert stats[GOJO] == {"chats": 3, "chatsThisWeek": 2, "likes": 1, "liked": False}
    assert stats["gallery:hello-kitty"]["chats"] == 0
    await characters_d1.set_liked(backend, USER, GOJO, True)
    assert (await characters_d1.gallery_stats(backend, USER))[GOJO]["liked"]
    await characters_d1.set_liked(backend, USER, GOJO, False)
    assert (await characters_d1.gallery_stats(backend, USER))[GOJO]["likes"] == 1
    made = await characters_d1.create(backend, USER, MINE)
    with pytest.raises(characters_d1.CharacterError):
        await characters_d1.set_liked(backend, USER, made["id"], True)


def test_like_route_and_listing(backend):
    from yomi.app.deps import get_current_user
    from yomi.app.main import app
    from yomi.services.cloudflare_storage.deps import get_d1_backend

    app.dependency_overrides[get_d1_backend] = lambda: backend
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
        id=USER, email="a@example.com", role="user", plan="explore"
    )
    try:
        http = TestClient(app)
        assert http.post(f"/api/characters/{GOJO}/like", json={"liked": True}).status_code == 200
        gojo = next(c for c in http.get("/api/characters").json()["gallery"] if c["id"] == GOJO)
        assert gojo["likes"] == 1 and gojo["liked"] is True and gojo["chats"] == 0
        assert http.post("/api/characters/nope/like", json={}).status_code == 400
    finally:
        app.dependency_overrides.clear()
