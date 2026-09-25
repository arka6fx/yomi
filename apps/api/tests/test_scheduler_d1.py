"""Schedule firing over a real SQLite D1 schema, plus timezone-aware parsing."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest
from d1_sqlite import sqlite_backend

from yomi.services import scheduler_d1
from yomi.services.agent.schedule_tools import register_schedule_tools
from yomi.services.agent.tools import ToolRegistry
from yomi.services.schedule_parser import compute_next_run

USER = "alice"


def _past(minutes: int = 1) -> str:
    return (datetime.now(UTC) - timedelta(minutes=minutes)).isoformat()


@pytest.fixture
def backend():
    db = sqlite_backend(USER)
    db.store.db.execute(
        "INSERT INTO platform_connections (user_id, platform, platform_user_id, platform_chat_id) "
        "VALUES (?, 'telegram', 'tg', 'chat-1')",
        [USER],
    )
    return db


def _schedule(backend, sid: str, schedule: str, stype: str, next_run: str, one_shot=0):
    backend.store.db.execute(
        "INSERT INTO schedules (id, user_id, schedule, schedule_type, prompt, enabled, one_shot, "
        "next_run_at, timezone) VALUES (?, ?, ?, ?, 'brief me', 1, ?, ?, 'Asia/Kolkata')",
        [sid, USER, schedule, stype, one_shot, next_run],
    )


def _row(backend, sid: str) -> dict:
    return dict(backend.store.db.execute("SELECT * FROM schedules WHERE id = ?", [sid]).fetchone())


def test_phrase_uses_local_time():
    now = datetime(2026, 9, 25, 17, 0, tzinfo=UTC)
    nxt = compute_next_run("phrase", "every day at 8am", now=now, tz="Asia/Kolkata")
    assert nxt == datetime(2026, 9, 26, 2, 30, tzinfo=UTC)
    assert compute_next_run("cron", "0 8 * * *", now=now) == datetime(2026, 9, 26, 8, tzinfo=UTC)


async def test_due_schedule_queues_one_run_and_advances(backend):
    _schedule(backend, "s1", "every day at 8am", "phrase", _past())
    assert await scheduler_d1.fire_due_schedules(backend) == 1
    runs = await backend.store.fetch_all("SELECT * FROM agent_runs")
    assert len(runs) == 1 and runs[0]["chat_id"] == "chat-1" and runs[0]["kind"] == "schedule"
    assert "brief me" in runs[0]["input_text"]
    row = _row(backend, "s1")
    assert row["enabled"] == 1 and row["run_count"] == 1 and row["last_run_status"] == "queued"
    assert row["next_run_at"] > datetime.now(UTC).isoformat()
    # Not due any more: a second tick queues nothing.
    assert await scheduler_d1.fire_due_schedules(backend) == 0


async def test_one_shot_disables_after_firing(backend):
    _schedule(backend, "s2", "2026-01-01T09:00:00+05:30", "iso", _past(), one_shot=1)
    assert await scheduler_d1.fire_due_schedules(backend) == 1
    row = _row(backend, "s2")
    assert row["enabled"] == 0 and row["next_run_at"] is None


async def test_future_and_disabled_schedules_are_ignored(backend):
    later = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    _schedule(backend, "s3", "every day at 8am", "phrase", later)
    assert await scheduler_d1.fire_due_schedules(backend) == 0


async def test_without_telegram_the_run_is_skipped(backend):
    backend.store.db.execute("DELETE FROM platform_connections")
    _schedule(backend, "s4", "every day at 8am", "phrase", _past())
    assert await scheduler_d1.fire_due_schedules(backend) == 0
    assert _row(backend, "s4")["last_run_status"] == "skipped"


async def test_agent_can_create_a_local_time_schedule(backend):
    backend.store.db.execute("UPDATE \"user\" SET plan = 'pro' WHERE id = ?", [USER])
    registry = ToolRegistry()
    register_schedule_tools(registry, backend, USER)
    result = json.loads(await registry.execute(
        "schedule_create", when="every day at 8am", task="morning brief"
    ))
    assert result["ok"] and result["timezone"] == "Asia/Kolkata"
    assert result["nextRunAt"].endswith("02:30:00+00:00")
    bad = json.loads(await registry.execute("schedule_create", when="whenever", task="x"))
    assert "error" in bad
