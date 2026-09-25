"""D1 implementation of schedule CRUD and the creation quota gate.

Mirrors ``app/routes/schedules.py`` and ``services/schedule_quota.py``.
Validation, next-run computation, and plan limits stay in the shared pure
modules; only storage moves.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import utcnow_iso
from yomi.services.entitlements import effective_plan_for_user, get_plan_config
from yomi.services.schedule_parser import schedule_limit_for_plan
from yomi.services.schedule_quota import QuotaUser


def schedule_dict(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "schedule": row["schedule"],
        "scheduleType": row["schedule_type"],
        "prompt": row["prompt"],
        "deliverTo": _parse_json(row.get("deliver_to")),
        "enabled": bool(row.get("enabled")),
        "oneShot": bool(row.get("one_shot")),
        "nextRunAt": row.get("next_run_at"),
        "timezone": row.get("timezone") or "UTC",
        "lastRunAt": row.get("last_run_at"),
        "lastRunStatus": row.get("last_run_status"),
        "lastRunError": row.get("last_run_error"),
        "runCount": row.get("run_count"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def _parse_json(value: Any) -> Any:
    if value is None or isinstance(value, list):
        return value
    if isinstance(value, str) and value:
        import json

        try:
            return json.loads(value)
        except ValueError:
            return None
    return None


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()


async def ensure_schedule_capacity(backend: D1Backend, user: QuotaUser) -> dict[str, Any]:
    user_id = user.get("id")
    plan = effective_plan_for_user(user)
    limit = schedule_limit_for_plan(plan)
    if limit <= 0:
        return {
            "ok": False,
            "status": 403,
            "body": {
                "error": (
                    f"Scheduling isn't on your {get_plan_config(user)['name']} plan. "
                    "Upgrade to Pro or Max to schedule tasks."
                ),
                "code": "feature_not_available",
                "upgradeUrl": "/dashboard?upgrade=true",
            },
        }
    rows = await backend.store.fetch_all(
        "SELECT COUNT(*) AS n FROM schedules WHERE user_id = ?", [user_id]
    )
    count = int(rows[0]["n"])
    if count >= limit:
        return {
            "ok": False,
            "status": 402,
            "body": {
                "error": f"You've hit your schedule limit ({count}/{limit}). Upgrade for more.",
                "code": "schedule_limit",
                "upgradeUrl": "/dashboard?upgrade=true",
            },
        }
    return {"ok": True}


async def list_schedules(backend: D1Backend, user_id: str) -> list[dict[str, Any]]:
    rows = await backend.store.fetch_all(
        "SELECT * FROM schedules WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
        [user_id],
    )
    return [schedule_dict(row) for row in rows]


async def create_schedule(
    backend: D1Backend,
    user_id: str,
    *,
    schedule: str,
    schedule_type: str,
    prompt: str,
    deliver_to: list,
    enabled: bool,
    next_run_at: datetime | None,
    timezone: str = "UTC",
) -> dict[str, Any]:
    now = utcnow_iso()
    schedule_id = str(uuid.uuid4())
    await backend.store.atomic([
        backend.store.insert("schedules", {
            "id": schedule_id,
            "user_id": user_id,
            "schedule": schedule,
            "schedule_type": schedule_type,
            "prompt": prompt,
            "deliver_to": deliver_to,
            "enabled": 1 if enabled else 0,
            "one_shot": 1 if schedule_type == "iso" else 0,
            "next_run_at": _iso(next_run_at),
            "timezone": timezone,
            "last_run_at": None,
            "last_run_status": None,
            "last_run_error": None,
            "run_count": 0,
            "created_at": now,
            "updated_at": now,
        })
    ])
    row = await backend.store.fetch_one(
        "SELECT * FROM schedules WHERE id = ? LIMIT 1", [schedule_id]
    )
    assert row is not None
    return schedule_dict(row)


async def get_schedule(
    backend: D1Backend, user_id: str, schedule_id: str
) -> dict | None:
    return await backend.store.fetch_one(
        "SELECT * FROM schedules WHERE user_id = ? AND id = ? LIMIT 1",
        [user_id, schedule_id],
    )


async def update_schedule(
    backend: D1Backend, user_id: str, schedule_id: str, updates: dict[str, Any]
) -> dict | None:
    encoded = {
        key: (_iso(value) if isinstance(value, datetime) else value)
        for key, value in updates.items()
    }
    encoded["updated_at"] = utcnow_iso()
    assignments = ", ".join(f"{key} = ?" for key in encoded)
    await backend.store.atomic([
        Statement(
            f"UPDATE schedules SET {assignments} WHERE user_id = ? AND id = ?",
            [*encoded.values(), user_id, schedule_id],
        )
    ])
    row = await get_schedule(backend, user_id, schedule_id)
    return schedule_dict(row) if row else None


async def delete_schedule(backend: D1Backend, user_id: str, schedule_id: str) -> int:
    results = await backend.store.atomic([
        Statement(
            "DELETE FROM schedules WHERE user_id = ? AND id = ? RETURNING id",
            [user_id, schedule_id],
        )
    ])
    return len(results[0].get("results") or [])
