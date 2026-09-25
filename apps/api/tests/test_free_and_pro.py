"""Free forever (3 active routines) and Pro (unlimited routines, smarter engine)."""

from __future__ import annotations

from contextlib import suppress
from datetime import UTC, datetime, timedelta

from d1_sqlite import sqlite_backend

from yomi.services import billing_d1, schedules_d1

USER = "alice"


def _plan(db) -> tuple[str, str]:
    row = db.store.db.execute(
        'SELECT plan, subscription_status FROM "user" WHERE id = ?', [USER]
    ).fetchone()
    return row["plan"], row["subscription_status"]


def _routine(db, rid: str, enabled: int = 1) -> None:
    db.store.db.execute(
        "INSERT INTO schedules (id, user_id, schedule, schedule_type, prompt, enabled, "
        "created_at, updated_at) VALUES (?, ?, 'every day at 8am', 'cron', 'x', ?, 'now', 'now')",
        [rid, USER, enabled],
    )


async def test_free_gets_three_active_routines_and_paused_ones_dont_count():
    db = sqlite_backend(USER)
    free = {"id": USER, "plan": "explore"}
    for i in range(3):
        assert (await schedules_d1.ensure_schedule_capacity(db, free))["ok"]
        _routine(db, f"r{i}")
    blocked = await schedules_d1.ensure_schedule_capacity(db, free)
    assert not blocked["ok"] and blocked["body"]["code"] == "schedule_limit"
    assert "Pro" in blocked["body"]["error"]

    db.store.db.execute("UPDATE schedules SET enabled = 0 WHERE id = 'r0'")
    assert (await schedules_d1.ensure_schedule_capacity(db, free))["ok"]
    for i in range(3, 20):
        _routine(db, f"r{i}")
    assert (await schedules_d1.ensure_schedule_capacity(db, {"id": USER, "plan": "pro"}))["ok"]


async def test_referral_month_of_pro_stacks_then_lapses():
    db = sqlite_backend(USER)
    assert await billing_d1.grant_pro_days(db, USER, 30)
    assert _plan(db) == ("pro", "referral")
    assert await billing_d1.grant_pro_days(db, USER, 30)  # a second invite extends it
    end = db.store.db.execute(
        'SELECT current_period_end FROM "user" WHERE id = ?', [USER]
    ).fetchone()[0]
    assert datetime.fromisoformat(end) > datetime.now(UTC) + timedelta(days=59)

    assert await billing_d1.expire_lapsed_pro(db) == 0
    past = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
    db.store.db.execute('UPDATE "user" SET current_period_end = ? WHERE id = ?', [past, USER])
    assert await billing_d1.expire_lapsed_pro(db) == 1
    assert _plan(db) == ("explore", "inactive")


async def test_paying_pro_is_never_touched_and_past_due_gets_grace():
    db = sqlite_backend(USER)
    recent = (datetime.now(UTC) - timedelta(days=3)).isoformat()
    db.store.db.execute(
        'UPDATE "user" SET plan = \'pro\', subscription_status = \'past_due\', '
        "current_period_end = ? WHERE id = ?",
        [recent, USER],
    )
    assert not await billing_d1.grant_pro_days(db, USER, 30)
    assert await billing_d1.expire_lapsed_pro(db) == 0  # still inside the 7-day grace
    old = (datetime.now(UTC) - timedelta(days=8)).isoformat()
    db.store.db.execute('UPDATE "user" SET current_period_end = ? WHERE id = ?', [old, USER])
    assert await billing_d1.expire_lapsed_pro(db) == 1
    assert _plan(db)[0] == "explore"


async def test_pro_runs_on_the_smarter_engine(monkeypatch):
    from yomi.services.agent import loop

    seen: list[str] = []
    monkeypatch.setattr(loop, "model_for", lambda purpose: seen.append(purpose) or "m")

    async def stop(*args, **kwargs):
        raise RuntimeError("stop")

    monkeypatch.setattr(loop, "build_user_registry", stop)
    for plan in ("explore", "pro"):
        with suppress(RuntimeError):
            await loop.run_agent_loop([], USER, plan, d1=object())
    assert seen == ["fast", "agent"]
