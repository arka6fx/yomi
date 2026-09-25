"""Agent tools to create, list and cancel the user's scheduled tasks (D1 only).

Scheduled tasks run on the Worker cron tick and deliver their result to the
user's Telegram chat (see ``services/scheduler_d1``).
"""

from __future__ import annotations

import json
from typing import Any

from yomi.services import schedules_d1
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.schedule_parser import compute_next_run, validate_schedule_input, zone

DEFAULT_TIMEZONE = "Asia/Kolkata"

MORNING_BRIEF_PROMPT = (
    "Give me my morning brief: today's calendar, important unread email, pending "
    "approvals, anything new in my Yomi inbox, and yesterday's spending. Keep it short "
    "and skip sections with nothing in them."
)


def register_schedule_tools(tool_registry: Any, backend: D1Backend, user_id: str) -> None:
    async def schedule_create(when: str, task: str, timezone: str | None = None) -> str:
        valid = validate_schedule_input(when.strip())
        if not valid.get("ok") or not valid.get("scheduleType"):
            return json.dumps({
                "error": valid.get("error", "invalid schedule"),
                "examples": [
                    "every day at 8am", "every weekday 9:30am", "every monday 10am",
                    "every 2 hours", "30m", "2026-10-01T09:00:00+05:30", "0 8 * * *",
                ],
            })
        user = await backend.store.fetch_one(
            'SELECT id, email, role, plan FROM "user" WHERE id = ?', [user_id]
        )
        capacity = await schedules_d1.ensure_schedule_capacity(backend, dict(user or {}))
        if not capacity.get("ok"):
            return json.dumps({"error": capacity.get("body", {}).get("error", "not allowed")})
        tz = timezone if timezone and zone(timezone).key == timezone else DEFAULT_TIMEZONE
        schedule_type = str(valid["scheduleType"])
        next_run = compute_next_run(schedule_type, when.strip(), tz=tz)
        if next_run is None:
            return json.dumps({"error": "That time is in the past or never occurs."})
        created = await schedules_d1.create_schedule(
            backend, user_id,
            schedule=when.strip(), schedule_type=schedule_type, prompt=task.strip(),
            deliver_to=["telegram"], enabled=True, next_run_at=next_run, timezone=tz,
        )
        return json.dumps({
            "ok": True, "id": created["id"], "nextRunAt": created["nextRunAt"], "timezone": tz,
            "note": "Runs start within about 10 minutes of the scheduled time.",
        })

    async def schedule_list() -> str:
        items = await schedules_d1.list_schedules(backend, user_id)
        return json.dumps({"schedules": [
            {k: s[k] for k in ("id", "schedule", "prompt", "enabled", "nextRunAt", "timezone")}
            for s in items
        ]})

    async def schedule_cancel(schedule_id: str) -> str:
        deleted = await schedules_d1.delete_schedule(backend, user_id, schedule_id)
        return json.dumps({"ok": bool(deleted)} if deleted else {"error": "schedule not found"})

    tool_registry.register(
        name="schedule_create",
        description=(
            "Schedule a recurring or one-time task that runs automatically and sends the "
            "result to the user on Telegram, e.g. a morning brief every day at 8am, a weekly "
            "summary, or a reminder. `when` accepts phrases (\"every day at 8am\", \"every "
            "weekday 9am\", \"every monday 10am\", \"every 2 hours\"), durations (\"30m\"), "
            "an ISO time for one-offs, or cron. For a morning brief use this task: "
            f"\"{MORNING_BRIEF_PROMPT}\""
        ),
        parameters={
            "type": "object",
            "properties": {
                "when": {"type": "string"},
                "task": {"type": "string", "description": "What to do each time, as an instruction"},
                "timezone": {"type": "string", "description": "IANA zone, default Asia/Kolkata"},
            },
            "required": ["when", "task"],
        },
        func=schedule_create,
    )
    tool_registry.register(
        name="schedule_list",
        description="List the user's scheduled tasks.",
        parameters={"type": "object", "properties": {}},
        func=schedule_list,
    )
    tool_registry.register(
        name="schedule_cancel",
        description="Delete one of the user's scheduled tasks by id.",
        parameters={
            "type": "object",
            "properties": {"schedule_id": {"type": "string"}},
            "required": ["schedule_id"],
        },
        func=schedule_cancel,
    )
