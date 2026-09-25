"""Pure-logic tests for services/schedule_parser.py (no live DB needed)."""

from __future__ import annotations

from datetime import UTC, datetime

from yomi.services.schedule_parser import (
    compute_next_run,
    parse_duration_ms,
    phrase_to_cron,
    schedule_limit_for_plan,
    validate_schedule_input,
)

FIXED_NOW = datetime(2026, 1, 5, 9, 0, tzinfo=UTC)  # Monday


def _next(schedule_type: str, schedule: str, last_run_at=None):
    return compute_next_run(schedule_type, schedule, last_run_at=last_run_at, now=FIXED_NOW)


def test_validate_duration():
    assert validate_schedule_input("30m") == {"ok": True, "scheduleType": "duration"}
    assert validate_schedule_input("2h")["scheduleType"] == "duration"
    assert validate_schedule_input("1d")["ok"] is True
    assert validate_schedule_input("0m")["ok"] is False
    assert validate_schedule_input("")["ok"] is False


def test_validate_iso():
    r = validate_schedule_input("2026-02-01T10:30")
    assert r["ok"] is True and r["scheduleType"] == "iso"
    assert validate_schedule_input("not-a-date")["ok"] is False


def test_validate_cron_and_phrase():
    assert validate_schedule_input("0 9 * * 1-5")["scheduleType"] == "cron"
    assert validate_schedule_input("every day 9am")["scheduleType"] == "phrase"
    assert validate_schedule_input("every forever")["ok"] is False
    assert validate_schedule_input("tomorrow")["ok"] is False


def test_parse_duration_ms():
    assert parse_duration_ms("30m") == 1_800_000
    assert parse_duration_ms(" 2H ") == 7_200_000
    assert parse_duration_ms("1d") == 86_400_000
    assert parse_duration_ms("bogus") is None


def test_phrase_to_cron():
    assert phrase_to_cron("every day 9am") == "0 9 * * *"
    assert phrase_to_cron("every day 9:30pm") == "30 21 * * *"
    assert phrase_to_cron("every monday 8am") == "0 8 * * 1"
    assert phrase_to_cron("every sunday 12am") == "0 0 * * 0"
    assert phrase_to_cron("every weekday 7:15pm") == "15 19 * * 1-5"
    assert phrase_to_cron("every 2 hours") == "0 */2 * * *"
    assert phrase_to_cron("every hour") == "0 * * * *"
    assert phrase_to_cron("whenever") is None


def test_compute_next_run_duration_no_last_run():
    r = _next("duration", "30m")
    assert r == FIXED_NOW


def test_compute_next_run_duration_with_last_run():
    last = datetime(2026, 1, 5, 8, 0, tzinfo=UTC)
    r = _next("duration", "2h", last_run_at=last)
    assert r == datetime(2026, 1, 5, 10, 0, tzinfo=UTC)


def test_compute_next_run_iso_future():
    r = _next("iso", "2026-02-01T10:30")
    assert r == datetime(2026, 2, 1, 10, 30, tzinfo=UTC)


def test_compute_next_run_iso_past_after_last_run():
    last = datetime(2026, 3, 1, 0, 0, tzinfo=UTC)
    assert _next("iso", "2026-02-01T10:30", last_run_at=last) is None


def test_compute_next_run_cron_skips_sunday_7():
    # Friday 2026-01-02 23:59 -> next Mon-Fri 9am is Monday 2026-01-05 09:00.
    now = datetime(2026, 1, 2, 23, 59, tzinfo=UTC)
    r = compute_next_run("cron", "0 9 * * 1-5", now=now)
    assert r == datetime(2026, 1, 5, 9, 0, tzinfo=UTC)


def test_compute_next_run_cron_same_day():
    # Monday 2026-01-05 08:30 -> 09:00 same day.
    now = datetime(2026, 1, 5, 8, 30, tzinfo=UTC)
    r = compute_next_run("cron", "0 9 * * 1-5", now=now)
    assert r == datetime(2026, 1, 5, 9, 0, tzinfo=UTC)


def test_compute_next_run_phrase_matches_cron():
    r = _next("phrase", "every day 9am")
    # now=09:00 is an inclusive boundary — next run lands on the following day
    assert r == datetime(2026, 1, 6, 9, 0, tzinfo=UTC)


def test_schedule_limits():
    assert schedule_limit_for_plan("explore") == 3
    assert schedule_limit_for_plan("pro") >= 1000
    assert schedule_limit_for_plan("nope") == 0
    assert schedule_limit_for_plan(None) == 0