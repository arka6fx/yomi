"""Character pictures for the maker: source lookups, Fandom paging, and photo uploads."""

from __future__ import annotations

import json
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from d1_sqlite import sqlite_backend
from fastapi.testclient import TestClient

from yomi.services import auth_d1, character_pictures, characters_d1, media
from yomi.services.cloudflare_storage.deps import D1Backend

USER = "alice"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
WIKI_IMG = "https://static.wikia.nocookie.net/jujutsu-kaisen/images/a/ab/{}/revision/latest?cb=1"


def _image(name: str, width: int = 800, mime: str = "image/png") -> dict:
    return {
        "title": f"File:{name}",
        "imageinfo": [{"url": WIKI_IMG.format(name), "width": width, "height": 900, "mime": mime}],
    }


def _fake_wiki(monkeypatch, *, pages_by_start: dict[str, tuple[list[dict], str | None]]):
    """A Jujutsu Kaisen wiki where Satoru_Gojo exists; other wikis 404."""
    hosts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = urlparse(str(request.url))
        hosts.append(url.netloc)
        if url.netloc != "jujutsu-kaisen.fandom.com":
            return httpx.Response(404)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if q.get("generator") == "images":
            pages, nxt = pages_by_start[q.get("gimcontinue", "")]
            body: dict = {"query": {"pages": pages}}
            if nxt:
                body["continue"] = {"gimcontinue": nxt}
            return httpx.Response(200, json=body)
        return httpx.Response(200, json={"query": {"pages": [{"title": "Satoru Gojo"}]}})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(character_pictures, "shared_client", lambda: client)
    return hosts


async def _no_lookup(query: str) -> list[dict]:
    return []


def test_wiki_candidates_and_scaling():
    assert character_pictures.wiki_candidates("Jujutsu Kaisen") == [
        "jujutsu-kaisen",
        "jujutsukaisen",
    ]
    assert character_pictures.wiki_candidates("The Last of Us") == ["last-of-us", "lastofus"]
    assert character_pictures.wiki_candidates("") == []
    assert character_pictures.scaled(WIKI_IMG.format("a.png")).endswith(
        "/revision/latest/scale-to-width-down/400?cb=1"
    )


async def test_first_page_has_portrait_then_wiki_pictures_and_skips_junk(monkeypatch):
    async def fake_lookup(query: str) -> list[dict]:
        return [
            {"name": "Satoru Gojo", "work": "Jujutsu Kaisen", "imageUrl": "https://anilist/g.png",
             "imageCredit": "AniList", "source": "anilist"},
            {"name": "Suguru Geto", "work": "Jujutsu Kaisen", "imageUrl": "https://anilist/s.png",
             "imageCredit": "AniList", "source": "anilist"},
        ]

    monkeypatch.setattr(character_pictures, "lookup", fake_lookup)
    _fake_wiki(monkeypatch, pages_by_start={
        "": ([_image("Gojo_anime.png"), _image("Site-logo.png"), _image("Tiny.png", width=64),
              _image("Anim.gif", mime="image/gif"), _image("Gojo_manga.jpg")], "next-1"),
    })
    result = await character_pictures.pictures("Satoru Gojo (Jujutsu Kaisen)")
    urls = [p["url"] for p in result["pictures"]]
    assert urls[0] == "https://anilist/g.png"  # the right character's portrait, not Geto's
    assert "https://anilist/s.png" not in urls
    assert [p["source"] for p in result["pictures"][1:]] == ["fandom", "fandom"]
    assert all("scale-to-width-down" in u for u in urls[1:])
    assert result["next"]


async def test_more_pictures_pages_through_the_wiki(monkeypatch):
    monkeypatch.setattr(character_pictures, "lookup", _no_lookup)
    _fake_wiki(monkeypatch, pages_by_start={
        "": ([_image("One.png")], "p2"),
        "p2": ([_image("Two.png"), _image("Three.png")], None),
    })
    first = await character_pictures.pictures("Satoru Gojo (Jujutsu Kaisen)")
    more = await character_pictures.pictures("Satoru Gojo (Jujutsu Kaisen)", first["next"])
    assert len(more["pictures"]) == 2
    assert more["next"] is None


async def test_a_tampered_cursor_never_reaches_another_host(monkeypatch):
    hosts = _fake_wiki(monkeypatch, pages_by_start={})
    evil = character_pictures._encode({"wiki": "evil.com/x?", "title": "a", "from": ""})
    assert await character_pictures.pictures("x", evil) == {"pictures": [], "next": None}
    assert await character_pictures.pictures("x", "not-base64!!") == {"pictures": [], "next": None}
    assert hosts == []


async def test_unknown_series_and_short_queries_return_nothing(monkeypatch):
    monkeypatch.setattr(character_pictures, "lookup", _no_lookup)
    _fake_wiki(monkeypatch, pages_by_start={})
    assert (await character_pictures.pictures("Nobody (Unknown Show)"))["pictures"] == []
    assert (await character_pictures.pictures("a"))["pictures"] == []


class FakeMedia:
    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    async def media_put(self, key, data, content_type):
        self.objects[key] = (data, content_type)


@pytest.fixture
def env():
    base = sqlite_backend(USER)
    fake = FakeMedia()
    backend = D1Backend(store=base.store, client=fake)  # type: ignore[arg-type]
    from yomi.app.deps import get_current_user
    from yomi.app.main import app
    from yomi.services.cloudflare_storage.deps import get_d1_backend

    async def current_user():
        return await auth_d1.find_user_by_id(backend, USER)

    app.dependency_overrides[get_d1_backend] = lambda: backend
    app.dependency_overrides[get_current_user] = current_user
    yield SimpleNamespace(http=TestClient(app), fake=fake)
    app.dependency_overrides.clear()


def test_photo_upload_stores_it_and_a_character_can_use_it(env):
    res = env.http.post("/api/characters/photo", content=PNG)
    assert res.status_code == 200
    url = res.json()["imageUrl"]
    assert url.startswith("/api/media/characters/alice/") and url.endswith(".png")
    assert media.is_character_upload(url)
    assert len(env.fake.objects) == 1
    fields = {"name": "Nova", "firstLines": ["hey"], "personality": "calm", "imageUrl": url}
    assert characters_d1.validate(fields)["image_url"] == url


def test_photo_upload_rejects_non_images(env):
    res = env.http.post("/api/characters/photo", content=b"<svg onload=alert(1)>")
    assert res.status_code == 400
    assert json.loads(res.text)["code"] == "invalid_image"


def test_avatar_keys_are_not_character_pictures():
    assert not media.is_character_upload("/api/media/avatars/alice/" + "a" * 36 + ".png")
    assert not media.is_character_upload("/api/media/characters/../../x.png")
