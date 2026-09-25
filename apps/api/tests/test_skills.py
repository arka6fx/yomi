"""Skills gallery: catalog integrity, add/remove over real SQLite, bot deep link."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from d1_sqlite import sqlite_backend
from fastapi.testclient import TestClient

from yomi.services.schedule_parser import validate_schedule_input
from yomi.services.skills import CATEGORIES, SKILLS, get_skill


def test_catalog_is_consistent():
    ids = [skill["id"] for skill in SKILLS]
    assert len(ids) == len(set(ids))
    for skill in SKILLS:
        assert skill["category"] in CATEGORIES
        assert skill["prompt"].strip()
        if skill["kind"] == "routine":
            assert validate_schedule_input(skill["schedule"])["ok"], skill["id"]
        else:
            assert "schedule" not in skill


@pytest.fixture
def client():
    from yomi.app.deps import get_current_user
    from yomi.app.main import app
    from yomi.services.cloudflare_storage.deps import get_d1_backend

    backend = sqlite_backend("alice")
    user = SimpleNamespace(id="alice", email="a@example.com", role="user", plan="pro")
    app.dependency_overrides[get_d1_backend] = lambda: backend
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield TestClient(app), backend, user
    finally:
        app.dependency_overrides.clear()


def test_add_list_and_remove_a_routine(client):
    http, backend, _ = client
    listed = http.get("/api/skills").json()
    assert listed["canSchedule"] is True
    assert not next(s for s in listed["skills"] if s["id"] == "morning-brief")["added"]

    added = http.post("/api/skills/morning-brief", json={"timezone": "Asia/Kolkata"})
    assert added.status_code == 200, added.text
    assert added.json()["schedule"]["skillId"] == "morning-brief"
    assert added.json()["schedule"]["nextRunAt"].endswith("02:30:00+00:00")
    assert http.post("/api/skills/morning-brief", json={}).status_code == 409

    brief = next(s for s in http.get("/api/skills").json()["skills"] if s["id"] == "morning-brief")
    assert brief["added"] and brief["nextRunAt"]

    assert http.delete("/api/skills/morning-brief").json() == {"ok": True}
    assert http.delete("/api/skills/morning-brief").status_code == 404


def test_chat_skills_and_free_plan_can_schedule(client):
    http, _, user = client
    assert http.post("/api/skills/meal-log", json={}).status_code == 404
    user.plan = "explore"
    assert http.get("/api/skills").json()["canSchedule"] is True
    assert http.post("/api/skills/morning-brief", json={}).status_code == 200


async def test_bot_deep_link_runs_the_skill_prompt(monkeypatch):
    from yomi.gateway import telegram

    seen: dict = {}

    async def fake_resolve(*args, **kwargs):
        return SimpleNamespace(id="alice")

    async def fake_enqueue(update, d1, user, chat_id, message_id, text, **kwargs):
        seen["text"] = text
        return {"status": "queued"}

    monkeypatch.setattr(telegram, "_resolve_yomi_user", fake_resolve)
    monkeypatch.setattr(telegram, "_metering_user", lambda row: {"id": row.id, "plan": "pro"})
    monkeypatch.setattr(telegram, "_enqueue_telegram_run", fake_enqueue)
    update = {"update_id": 1, "message": {
        "message_id": 5, "chat": {"id": 9}, "from": {"id": 9}, "text": "/start skill_meal-log",
    }}
    await telegram._handle_update(update, None, d1=object())
    assert seen["text"] == get_skill("meal-log")["prompt"]
