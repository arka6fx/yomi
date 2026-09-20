"""/api/schedules — cloud-managed schedule CRUD.

Port of apps/backend/src/routes/schedules.ts. The cron runner itself
(schedule-runner.ts) is a worker-phase port and is not part of this router.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import desc, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.db.models_app import Schedule
from yomi.db.models_auth import User
from yomi.services.entitlements import effective_plan_for_user
from yomi.services.schedule_parser import (
    compute_next_run,
    schedule_limit_for_plan,
    validate_schedule_input,
)
from yomi.services.schedule_quota import ensure_schedule_capacity

schedules_router = APIRouter(prefix="/api/schedules")


def _schedule_dict(row: Schedule) -> dict[str, Any]:
    return {
        "id": row.id,
        "userId": row.user_id,
        "schedule": row.schedule,
        "scheduleType": row.schedule_type,
        "prompt": row.prompt,
        "deliverTo": row.deliver_to,
        "enabled": row.enabled,
        "oneShot": row.one_shot,
        "nextRunAt": row.next_run_at,
        "lastRunAt": row.last_run_at,
        "lastRunStatus": row.last_run_status,
        "lastRunError": row.last_run_error,
        "runCount": row.run_count,
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    }


async def _json_body(request: Request) -> dict[str, Any]:
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


@schedules_router.get("/")
async def list_schedules(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(Schedule)
            .where(Schedule.user_id == user.id)
            .order_by(desc(Schedule.created_at))
            .limit(100)
        )
    ).scalars()
    return {
        "schedules": [_schedule_dict(r) for r in rows],
        "limit": schedule_limit_for_plan(effective_plan_for_user({"plan": user.plan})),
    }


@schedules_router.post("/")
async def create_schedule(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    body = await _json_body(request)

    capacity = await ensure_schedule_capacity(
        db, {"id": user.id, "email": user.email, "role": user.role, "plan": user.plan}
    )
    if not capacity.get("ok"):
        denied = capacity
        return JSONResponse(
            denied.get("body", {"error": "Scheduling is not available"}),
            status_code=int(denied.get("status", 403)),
        )

    schedule = body.get("schedule")
    prompt = body.get("prompt")
    if not isinstance(schedule, str) or not schedule.strip():
        return JSONResponse(
            {"error": "schedule is required", "code": "invalid_schedule"}, status_code=400
        )
    if not isinstance(prompt, str) or not prompt.strip():
        return JSONResponse(
            {"error": "prompt is required", "code": "invalid_prompt"}, status_code=400
        )
    schedule = schedule.strip()

    valid = validate_schedule_input(schedule)
    if not valid.get("ok") or not valid.get("scheduleType"):
        error = valid.get("error", "invalid schedule")
        return JSONResponse(
            {"error": error, "code": "invalid_schedule"}, status_code=400
        )
    schedule_type = valid["scheduleType"]

    next_run_at = compute_next_run(schedule_type, schedule)
    deliver_to = body.get("deliverTo")
    if not isinstance(deliver_to, list) or not deliver_to:
        deliver_to = ["telegram"]
    enabled = body.get("enabled")
    if not isinstance(enabled, bool):
        enabled = True

    row = (
        await db.execute(
            pg_insert(Schedule)
            .values(
                user_id=user.id,
                schedule=schedule,
                schedule_type=schedule_type,
                prompt=prompt.strip(),
                deliver_to=deliver_to,
                enabled=enabled,
                one_shot=schedule_type == "iso",
                next_run_at=next_run_at,
            )
            .returning(Schedule)
        )
    ).scalar_one_or_none()
    if row is None:
        return JSONResponse({"error": "Failed to create schedule"}, status_code=500)
    return {"schedule": _schedule_dict(row)}


@schedules_router.patch("/{schedule_id}")
async def update_schedule(
    schedule_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    body = await _json_body(request)

    existing = (
        await db.execute(
            select(Schedule)
            .where(Schedule.user_id == user.id, Schedule.id == schedule_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing is None:
        return JSONResponse({"error": "schedule not found", "code": "not_found"}, status_code=404)

    updates: dict[str, Any] = {"updated_at": datetime.now(UTC)}
    schedule_str = existing.schedule
    schedule_type: str = existing.schedule_type

    new_schedule = body.get("schedule")
    if (
        isinstance(new_schedule, str)
        and new_schedule.strip()
        and new_schedule.strip() != existing.schedule
    ):
        valid = validate_schedule_input(new_schedule.strip())
        if not valid.get("ok") or not valid.get("scheduleType"):
            error = valid.get("error", "invalid schedule")
            return JSONResponse(
                {"error": error, "code": "invalid_schedule"}, status_code=400
            )
        schedule_str = body["schedule"].strip()
        schedule_type = valid["scheduleType"]
        updates["schedule"] = schedule_str
        updates["schedule_type"] = schedule_type
        updates["one_shot"] = schedule_type == "iso"
    if isinstance(body.get("prompt"), str) and body["prompt"].strip():
        updates["prompt"] = body["prompt"].strip()
    if isinstance(body.get("deliverTo"), list):
        updates["deliver_to"] = body["deliverTo"]
    if isinstance(body.get("enabled"), bool):
        updates["enabled"] = body["enabled"]

    # Recompute next run when the schedule changed or the job was (re)enabled.
    enabled_now = updates.get("enabled", existing.enabled)
    if "schedule" in updates or (updates.get("enabled") is True and not existing.enabled):
        updates["next_run_at"] = (
            compute_next_run(schedule_type, schedule_str, last_run_at=existing.last_run_at)
            if enabled_now and schedule_type
            else None
        )
    elif updates.get("enabled") is False:
        updates["next_run_at"] = None

    row = (
        await db.execute(
            update(Schedule)
            .where(Schedule.user_id == user.id, Schedule.id == schedule_id)
            .values(**updates)
            .returning(Schedule)
        )
    ).scalar_one_or_none()
    if row is None:
        return JSONResponse({"error": "schedule not found", "code": "not_found"}, status_code=404)
    return {"schedule": _schedule_dict(row)}


@schedules_router.delete("/{schedule_id}")
async def delete_schedule(
    schedule_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    from sqlalchemy import delete

    result = await db.execute(
        delete(Schedule).where(Schedule.user_id == user.id, Schedule.id == schedule_id)
    )
    return {"ok": True, "deleted": result.rowcount or 0}