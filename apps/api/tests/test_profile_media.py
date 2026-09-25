"""Profile pictures (R2 via the storage gateway) and the profile bio."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from d1_sqlite import sqlite_backend
from fastapi.testclient import TestClient

from yomi.services import auth_d1, media
from yomi.services.cloudflare_storage.deps import D1Backend

USER = "alice"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


class FakeMedia:
    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    async def media_put(self, key, data, content_type):
        self.objects[key] = (data, content_type)

    async def media_read(self, key):
        return self.objects.get(key)

    async def media_delete(self, key):
        self.objects.pop(key, None)


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
    yield SimpleNamespace(http=TestClient(app), backend=backend, fake=fake)
    app.dependency_overrides.clear()


def test_sniff_trusts_bytes_not_names():
    assert media.check_avatar(PNG) == ("png", "image/png")
    for bad in (b"", b"<svg onload=alert(1)>", b"GIF8" + b"\x00" * 10):
        with pytest.raises(media.MediaError):
            media.check_avatar(bad)
    with pytest.raises(media.MediaError, match="2 MB"):
        media.check_avatar(PNG + b"\x00" * media.MAX_AVATAR_BYTES)


def test_upload_serve_and_replace_avatar(env):
    first = env.http.post("/api/user/avatar", content=PNG).json()["image"]
    assert first.startswith("/api/media/avatars/alice/") and first.endswith(".png")
    served = env.http.get(first)
    assert served.status_code == 200 and served.content == PNG
    assert served.headers["content-type"] == "image/png"
    assert "immutable" in served.headers["cache-control"]

    second = env.http.post("/api/user/avatar", content=JPG).json()["image"]
    assert second.endswith(".jpg") and env.http.get("/api/user/me").json()["image"] == second
    assert list(env.fake.objects) == [second.removeprefix("/api/media/")]  # old one deleted

    assert env.http.delete("/api/user/avatar").json() == {"image": None}
    assert env.fake.objects == {} and env.http.get(second).status_code == 404


def test_rejects_non_images_and_bad_keys(env):
    bad = env.http.post("/api/user/avatar", content=b"<html>hi</html>")
    assert bad.status_code == 400 and bad.json()["code"] == "invalid_image"
    assert env.http.get("/api/media/../secrets").status_code == 404
    assert env.http.get("/api/media/avatars/alice/not-a-uuid.png").status_code == 404


async def test_bio_saves_and_reaches_the_agent(env):
    from yomi.services.agent.loop import _system_prompt

    saved = env.http.patch("/api/user/profile", json={"bio": "  student in  kolkata, loves chess "})
    assert saved.json()["bio"] == "student in kolkata, loves chess"
    assert env.http.get("/api/user/me").json()["bio"] == "student in kolkata, loves chess"
    too_long = env.http.patch("/api/user/profile", json={"bio": "x" * 281})
    assert too_long.status_code == 400 and too_long.json()["code"] == "invalid_bio"

    prompt = await _system_prompt(None, env.backend, USER)
    assert "<about_user>" in prompt and "loves chess" in prompt
    # the bio column isn't on the shared model; loading the user must still work
    assert (await auth_d1.find_user_by_id(env.backend, USER)).id == USER
