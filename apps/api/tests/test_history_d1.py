"""Conversation history for the dashboard, and routine run outcomes, on real SQLite D1."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from d1_sqlite import sqlite_backend
from fastapi import FastAPI
from fastapi.testclient import TestClient

from yomi.app.deps import get_current_user
from yomi.app.routes.conversation import conversation_router
from yomi.app.routes.history import history_router
from yomi.services import runs_d1, scheduler_d1
from yomi.services.agent import sessions_d1
from yomi.services.cloudflare_storage.deps import get_d1_backend


@pytest.fixture
def backend():
    return sqlite_backend("alice", "bob")


async def _chat(backend, user: str, chat: str, *turns: tuple[str, str]) -> None:
    for role, content in turns:
        await sessions_d1.append_turn(backend, user, "telegram", chat, role, content)


async def test_reset_closes_the_thread_and_keeps_it_in_history(backend):
    await _chat(backend, "alice", "c1", ("user", "plan my trip to goa"), ("assistant", "sure"))
    await sessions_d1.close_sessions(backend, "alice", "telegram", "c1")
    # The agent starts fresh...
    assert await sessions_d1.load_history(backend, "alice", "telegram", "c1") == []
    assert await sessions_d1.load_shared_thread(backend, "alice") == []
    # ...but the old thread is still readable in history.
    await _chat(backend, "alice", "c1", ("user", "hello again"))
    sessions = await sessions_d1.list_sessions(backend, "alice")
    assert [s["title"] for s in sessions] == ["hello again", "plan my trip to goa"]
    assert [s["active"] for s in sessions] == [True, False]
    assert sessions[1]["closedAt"] is not None
    assert sessions[1]["lastMessage"] == {"role": "assistant", "content": "sure"}


async def test_history_search_detail_and_isolation(backend):
    await _chat(backend, "alice", "c1", ("user", "book a table"), ("assistant", "done"))
    await sessions_d1.close_sessions(backend, "alice")
    await _chat(backend, "alice", "c1", ("user", "what's the weather"))
    await _chat(backend, "bob", "c2", ("user", "book a table too"))

    hits = await sessions_d1.list_sessions(backend, "alice", query="table")
    assert len(hits) == 1 and hits[0]["title"] == "book a table"
    assert await sessions_d1.list_sessions(backend, "alice", query="100%") == []

    detail = await sessions_d1.get_session_detail(backend, "alice", hits[0]["id"])
    assert detail is not None
    assert [(m["role"], m["content"]) for m in detail["messages"]] == [
        ("user", "book a table"),
        ("assistant", "done"),
    ]
    # Bob can't open Alice's conversation.
    assert await sessions_d1.get_session_detail(backend, "bob", hits[0]["id"]) is None


async def test_shared_thread_is_the_live_conversation(backend):
    await _chat(backend, "alice", "c1", ("user", "hi"), ("assistant", "hey"))
    thread = await sessions_d1.load_shared_thread(backend, "alice")
    assert [(t["role"], t["content"]) for t in thread] == [("user", "hi"), ("assistant", "hey")]


async def test_routes_serve_history_and_reset(backend):
    await _chat(backend, "alice", "c1", ("user", "remind me to call mum"), ("assistant", "ok"))
    app = FastAPI()
    app.include_router(history_router)
    app.include_router(conversation_router)

    class _User:
        id = "alice"

    app.dependency_overrides[get_current_user] = lambda: _User()
    app.dependency_overrides[get_d1_backend] = lambda: backend
    client = TestClient(app)

    listed = client.get("/api/history/sessions?limit=20")
    assert listed.status_code == 200
    session = listed.json()["sessions"][0]
    assert session["title"] == "remind me to call mum"

    detail = client.get(f"/api/history/sessions/{session['id']}")
    assert detail.status_code == 200 and len(detail.json()["messages"]) == 2
    assert client.get("/api/history/sessions/nope").status_code == 404

    shared = client.get("/api/conversation/shared")
    assert shared.status_code == 200 and len(shared.json()["history"]) == 2
    assert client.post("/api/conversation/shared/reset").status_code == 200
    assert client.get("/api/conversation/shared").json()["history"] == []
    assert len(client.get("/api/history/sessions").json()["sessions"]) == 1


def _due_schedule(backend) -> None:
    db = backend.store.db
    db.execute(
        "INSERT INTO platform_connections (user_id, platform, platform_user_id, platform_chat_id) "
        "VALUES ('alice', 'telegram', 'tg', 'chat-1')"
    )
    past = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
    db.execute(
        "INSERT INTO schedules (id, user_id, schedule, schedule_type, prompt, enabled, "
        "next_run_at, timezone) VALUES ('s1', 'alice', 'every day at 8am', 'phrase', "
        "'brief me', 1, ?, 'Asia/Kolkata')",
        [past],
    )


def _status(backend) -> tuple[str, str | None]:
    row = backend.store.db.execute(
        "SELECT last_run_status, last_run_error FROM schedules WHERE id = 's1'"
    ).fetchone()
    return row[0], row[1]


async def test_routine_run_outcome_lands_on_the_schedule(backend):
    _due_schedule(backend)
    assert await scheduler_d1.fire_due_schedules(backend) == 1
    assert _status(backend) == ("queued", None)
    run = await backend.store.fetch_one("SELECT id FROM agent_runs")
    await runs_d1.complete_run(backend, run["id"], "here's your brief")
    assert _status(backend) == ("succeeded", None)


async def test_failed_routine_run_shows_a_reason(backend):
    _due_schedule(backend)
    await scheduler_d1.fire_due_schedules(backend)
    run = await backend.store.fetch_one("SELECT id FROM agent_runs")
    backend.store.db.execute(
        "UPDATE agent_runs SET attempts = max_attempts WHERE id = ?", [run["id"]]
    )
    assert await runs_d1.fail_run(backend, run["id"], "timed out after 120s") == "failed"
    assert _status(backend) == ("failed", "The last run timed out")


async def test_chat_runs_leave_schedules_alone(backend):
    _due_schedule(backend)
    run, _ = await runs_d1.create_run(
        backend, user_id="alice", chat_id="chat-1", update_id="12345", kind="chat",
        input_text="hi", plan="free",
    )
    await runs_d1.complete_run(backend, str(run["id"]), "hey")
    status, _ = _status(backend)
    assert status is None


async def test_dashboard_message_joins_the_telegram_thread(backend, monkeypatch):
    backend.store.db.execute(
        "INSERT INTO platform_connections (user_id, platform, platform_user_id, platform_chat_id) "
        "VALUES ('alice', 'telegram', 'tg', 'chat-1')"
    )
    seen: list[list[dict]] = []

    async def fake_loop(history, user_id, plan, **_):
        seen.append(list(history))
        return "  on it  "

    monkeypatch.setattr("yomi.services.agent.loop.run_agent_loop", fake_loop)
    app = FastAPI()
    app.include_router(conversation_router)

    class _User:
        id = "alice"
        plan = "explore"

    app.dependency_overrides[get_current_user] = lambda: _User()
    app.dependency_overrides[get_d1_backend] = lambda: backend
    client = TestClient(app)

    sent = client.post("/api/conversation/shared/send", json={"text": "book a cab"})
    assert sent.status_code == 200
    assert sent.json()["reply"] == {"role": "assistant", "content": "on it"}
    assert seen[0][-1] == {"role": "user", "content": "book a cab"}
    # It landed in Alice's Telegram chat, so Telegram carries on from here.
    history = await sessions_d1.load_history(backend, "alice", "telegram", "chat-1")
    assert [t["content"] for t in history] == ["book a cab", "on it"]
    assert client.post("/api/conversation/shared/send", json={"text": "  "}).status_code == 422


async def test_live_thread_falls_back_to_the_web(backend):
    assert await sessions_d1.live_thread(backend, "bob") == ("web", "bob")
    await _chat(backend, "bob", "c9", ("user", "hi"))
    assert await sessions_d1.live_thread(backend, "bob") == ("telegram", "c9")
