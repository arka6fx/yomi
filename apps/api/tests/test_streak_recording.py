"""Streaks are recorded again: per-message counting, the live streak, the leaderboard
filter, and the 0014 backfill from stored messages. Real schema via SQLite."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

from d1_sqlite import sqlite_backend

from yomi.services import streaks_d1
from yomi.services.agent import sessions_d1

MIGRATION = Path(__file__).resolve().parents[1] / "migrations-d1" / "0014_backfill_streaks.sql"
DAY = date(2026, 9, 20)


async def _user(backend, user_id: str) -> dict:
    return await backend.store.fetch_one(
        "SELECT current_streak, longest_streak, total_messages_sent, last_active_date "
        "FROM user WHERE id = ?",
        [user_id],
    )


async def test_messages_count_and_extend_the_streak_once_a_day():
    backend = sqlite_backend("arka")
    await streaks_d1.record_message(backend, "arka", DAY)
    await streaks_d1.record_message(backend, "arka", DAY)  # same day: count only
    row = await _user(backend, "arka")
    assert (row["total_messages_sent"], row["current_streak"], row["longest_streak"]) == (2, 1, 1)

    await streaks_d1.record_message(backend, "arka", DAY + timedelta(days=1))
    await streaks_d1.record_message(backend, "arka", DAY + timedelta(days=2))
    row = await _user(backend, "arka")
    assert (row["current_streak"], row["longest_streak"]) == (3, 3)
    assert row["last_active_date"] == (DAY + timedelta(days=2)).isoformat()


async def test_a_missed_day_restarts_the_streak_but_keeps_the_longest():
    backend = sqlite_backend("arka")
    for offset in range(3):
        await streaks_d1.record_message(backend, "arka", DAY + timedelta(days=offset))
    await streaks_d1.record_message(backend, "arka", DAY + timedelta(days=5))
    row = await _user(backend, "arka")
    assert (row["current_streak"], row["longest_streak"], row["total_messages_sent"]) == (1, 3, 4)


async def test_stats_show_zero_once_the_streak_has_lapsed():
    backend = sqlite_backend("arka")
    await streaks_d1.record_message(backend, "arka", DAY)
    await streaks_d1.record_message(backend, "arka", DAY + timedelta(days=1))
    row = {"current_streak": 2, "last_active_date": (DAY + timedelta(days=1)).isoformat()}
    assert streaks_d1._live_streak(row, DAY + timedelta(days=2)) == 2  # yesterday: alive
    assert streaks_d1._live_streak(row, DAY + timedelta(days=3)) == 0  # missed a day


async def test_leaderboard_leaves_out_people_who_never_messaged():
    backend = sqlite_backend("arka", "idle-1", "idle-2")
    await backend.store.fetch_all(
        "UPDATE user SET leaderboard_opt_in = 1, leaderboard_handle = 'arka6fx' WHERE id = 'arka'"
    )
    await backend.store.fetch_all(
        "UPDATE user SET leaderboard_opt_in = 1 WHERE id IN ('idle-1', 'idle-2')"
    )
    await streaks_d1.record_message(backend, "arka", DAY)
    board = await streaks_d1.get_leaderboard(backend, "arka")
    assert [e["handle"] for e in board["entries"]] == ["arka6fx"]
    assert board["yourRank"] == 1


async def test_backfill_rebuilds_counts_and_streaks_from_stored_messages():
    backend = sqlite_backend("arka", "quiet")
    await sessions_d1.append_turn(backend, "arka", "telegram", "c1", "user", "hi")
    await sessions_d1.append_turn(backend, "arka", "telegram", "c1", "assistant", "hey")
    await sessions_d1.append_turn(backend, "arka", "telegram", "c1", "user", "again")
    # Spread arka's messages over three consecutive days, then a gap, then one more day.
    # 18:45 UTC is already the next day in India, so dates are written in India time.
    stamps = [
        "2026-09-10T10:00:00+00:00",  # Sep 10 IST
        "2026-09-10T20:00:00+00:00",  # Sep 11 IST (01:30)
        "2026-09-12T08:00:00+00:00",  # Sep 12 IST
        "2026-09-20T09:00:00+00:00",  # Sep 20 IST
        "2026-09-21T09:00:00+00:00",  # Sep 21 IST
    ]
    db = backend.store.db
    db.execute("DELETE FROM agent_messages")
    for i, stamp in enumerate(stamps):
        db.execute(
            "INSERT INTO agent_messages (id, session_id, user_id, role, content, created_at) "
            "SELECT ?, id, 'arka', 'user', 'm', ? FROM agent_sessions LIMIT 1",
            [f"m{i}", stamp],
        )
    db.executescript(MIGRATION.read_text(encoding="utf-8"))
    row = await _user(backend, "arka")
    assert row["total_messages_sent"] == 5
    assert row["longest_streak"] == 3  # Sep 10-12
    assert row["current_streak"] == 2  # Sep 20-21
    assert row["last_active_date"] == "2026-09-21"
    assert (await _user(backend, "quiet"))["total_messages_sent"] == 0

    # Running it again changes nothing.
    db.executescript(MIGRATION.read_text(encoding="utf-8"))
    assert await _user(backend, "arka") == row
