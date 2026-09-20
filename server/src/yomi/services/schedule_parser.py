"""Schedule parsing for cloud-managed schedules.

Port of apps/backend/src/services/schedule-parser.ts. Self-contained (no cron
lib) since the accepted formats are a known, limited set. All evaluation is UTC.
Supported: duration ("30m", "2h", "1d"), phrase ("every day 9am"), 5-field cron
("0 9 * * 1-5"), and ISO timestamp.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

ScheduleType = str

_MAX_SCAN_MINUTES = 366 * 24 * 60

_DURATION_RE = re.compile(r"^(\d+)([mhd])$")
_MIN_SCHEDULE_RE = re.compile(r"^\d+[mhd]$")
_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")
_CRON_FIVE_RE = re.compile(r"^(\S+\s+){4}\S+$")

_DAYMAP = {
    "sunday": 0,
    "monday": 1,
    "tuesday": 2,
    "wednesday": 3,
    "thursday": 4,
    "friday": 5,
    "saturday": 6,
}

# Plan limits. Explore has no scheduling.
SCHEDULE_LIMITS: dict[str, int] = {"explore": 0, "pro": 5, "max": 20}


def schedule_limit_for_plan(plan: str | None) -> int:
    if not plan:
        return 0
    return SCHEDULE_LIMITS.get(plan.lower(), 0)


def validate_schedule_input(schedule: str) -> dict[str, object]:
    if not schedule or not isinstance(schedule, str):
        return {"ok": False, "error": "schedule is required"}
    trimmed = schedule.strip().lower()

    if _MIN_SCHEDULE_RE.match(trimmed):
        duration_n = re.sub(r"[mhd]", "", trimmed)
        if trimmed.endswith("m") and int(duration_n, 10) < 1:
            return {"ok": False, "error": "minimum duration is 1m"}
        return {"ok": True, "scheduleType": "duration"}
    if _ISO_RE.match(schedule):
        try:
            datetime.fromisoformat(_normalize_iso(schedule))
        except ValueError:
            return {"ok": False, "error": "invalid ISO timestamp"}
        return {"ok": True, "scheduleType": "iso"}
    if _CRON_FIVE_RE.match(trimmed):
        return {"ok": True, "scheduleType": "cron"}
    if trimmed.startswith("every"):
        if not phrase_to_cron(trimmed):
            return {"ok": False, "error": f'unrecognised phrase: "{schedule}"'}
        return {"ok": True, "scheduleType": "phrase"}
    return {"ok": False, "error": f'unrecognised schedule format: "{schedule}"'}


def _normalize_iso(value: str) -> str:
    return value if value.endswith(("Z", "+00:00")) else f"{value}Z"


def parse_duration_ms(schedule: str) -> int | None:
    m = re.match(_DURATION_RE.pattern, schedule.strip().lower())
    if not m:
        return None
    n = int(m.group(1), 10)
    unit = m.group(2)
    if unit == "m":
        return n * 60_000
    if unit == "h":
        return n * 3_600_000
    return n * 86_400_000


def phrase_to_cron(phrase: str) -> str | None:
    p = phrase.lower().strip()
    day_match = re.match(
        r"^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+"
        r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$",
        p,
    )
    if day_match:
        day = _DAYMAP.get(day_match.group(1))
        hour, minute = _to24h(day_match.group(2), day_match.group(3), day_match.group(4))
        if day is not None and hour is not None:
            return f"{minute} {hour} * * {day}"
    every_n = re.match(r"^every\s+(\d+)\s*(h|hour|hours)$", p)
    if every_n:
        n = int(every_n.group(1), 10)
        if n >= 1:
            return f"0 */{n} * * *"
    day_at = re.match(r"^every\s+day\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$", p)
    if day_at:
        hour, minute = _to24h(day_at.group(1), day_at.group(2), day_at.group(3))
        if hour is not None:
            return f"{minute} {hour} * * *"
    if re.match(r"^every\s*(hour|1h|1\s*hour)$", p):
        return "0 * * * *"
    weekday = re.match(r"^every\s+weekday\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$", p)
    if weekday:
        hour, minute = _to24h(weekday.group(1), weekday.group(2), weekday.group(3))
        if hour is not None:
            return f"{minute} {hour} * * 1-5"
    return None


def _to24h(hour_str: str, min_str: str | None, ampm: str | None) -> tuple[int | None, int]:
    hour = int(hour_str, 10)
    minute = int(min_str, 10) if min_str else 0
    if ampm:
        lower = ampm.lower()
        if lower == "pm" and hour < 12:
            hour += 12
        if lower == "am" and hour == 12:
            hour = 0
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None, 0
    return hour, minute


def _match_field(value: int, expr: str, min: int, max: int) -> bool:
    for part in expr.split(","):
        split = part.split("/")
        range_part = split[0]
        step_part = split[1] if len(split) > 1 else None
        step = int(step_part, 10) if step_part else 1
        if step < 1:
            continue
        lo = min
        hi = max
        if range_part and range_part != "*":
            if "-" in range_part:
                parts = range_part.split("-")
                try:
                    a = int(parts[0], 10)
                    b = int(parts[1], 10)
                except ValueError:
                    continue
                lo = a
                hi = b
            else:
                try:
                    n = int(range_part, 10)
                except ValueError:
                    continue
                lo = n
                hi = max if step_part else n
        if value < lo or value > hi:
            continue
        if (value - lo) % step == 0:
            return True
    return False


def _matches_cron(dt: datetime, cron_expr: str) -> bool:
    fields = cron_expr.strip().split()
    if len(fields) != 5:
        return False
    minute, hour, dom, mon, dow_raw = fields
    dow = dt.weekday()  # 0=Mon..6=Sun in Python
    cron_dow = (dow + 1) % 7  # 0=Sun..6=Sat like cron
    return (
        _match_field(dt.minute, minute, 0, 59)
        and _match_field(dt.hour, hour, 0, 23)
        and _match_field(dt.day, dom, 1, 31)
        and _match_field(dt.month, mon, 1, 12)
        and (
            _match_field(cron_dow, dow_raw, 0, 6)
            # cron allows 7 for Sunday; normalise by also testing dow+7
            or _match_field(7 if cron_dow == 0 else cron_dow, dow_raw, 0, 7)
        )
    )


def _next_cron_run(cron_expr: str, after: datetime) -> datetime | None:
    start = after.replace(second=0, microsecond=0)
    start = start + timedelta(minutes=1)  # strictly after
    base = start.timestamp()
    for i in range(_MAX_SCAN_MINUTES):
        candidate = datetime.fromtimestamp(base + i * 60, tz=UTC)
        if _matches_cron(candidate, cron_expr):
            return candidate
    return None


def compute_next_run(
    schedule_type: str,
    schedule: str,
    last_run_at: datetime | None = None,
    now: datetime | None = None,
) -> datetime | None:
    now = now if now is not None else datetime.now(UTC)
    if schedule_type == "duration":
        interval = parse_duration_ms(schedule)
        if interval is None:
            return None
        if not last_run_at:
            return now
        return last_run_at + timedelta(milliseconds=interval)
    if schedule_type == "iso":
        try:
            target = datetime.fromisoformat(_normalize_iso(schedule)).astimezone(UTC)
        except ValueError:
            return None
        if last_run_at and last_run_at.timestamp() >= target.timestamp():
            return None
        return target
    if schedule_type == "cron":
        after = last_run_at if last_run_at and last_run_at > now else now
        return _next_cron_run(schedule, after)
    if schedule_type == "phrase":
        expr = phrase_to_cron(schedule)
        if not expr:
            return None
        after = last_run_at if last_run_at and last_run_at > now else now
        return _next_cron_run(expr, after)
    return None