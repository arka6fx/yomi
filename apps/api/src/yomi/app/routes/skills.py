"""/api/skills — the skills gallery (D1 only).

Routine skills are added as schedules tagged with ``skill_id``; chat skills are
tried from the bot link ``t.me/<bot>?start=skill_<id>`` and need no state here.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from yomi.app.deps import get_current_user
from yomi.db.models_auth import User
from yomi.services import schedules_d1
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend
from yomi.services.entitlements import effective_plan_for_user
from yomi.services.schedule_parser import (
    compute_next_run,
    schedule_limit_for_plan,
    validate_schedule_input,
    zone,
)
from yomi.services.skills import CATEGORIES, SKILLS, get_skill, public_skill

skills_router = APIRouter(prefix="/api/skills")

DEFAULT_TIMEZONE = "Asia/Kolkata"


def _require(d1: D1Backend | None) -> D1Backend:
    if d1 is None:
        raise HTTPException(status_code=501, detail="Skills require the D1 storage backend")
    return d1


def _quota_user(user: User) -> dict:
    return {"id": user.id, "email": user.email, "role": user.role, "plan": user.plan}


@skills_router.get("")
async def list_skills(
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    backend = _require(d1)
    rows = await backend.store.fetch_all(
        "SELECT id, skill_id, enabled, next_run_at FROM schedules "
        "WHERE user_id = ? AND skill_id IS NOT NULL",
        [user.id],
    )
    added = {str(r["skill_id"]): r for r in rows}
    skills = []
    for skill in SKILLS:
        item = public_skill(skill)
        row = added.get(skill["id"])
        item["added"] = row is not None
        item["nextRunAt"] = row.get("next_run_at") if row else None
        skills.append(item)
    plan = effective_plan_for_user(_quota_user(user))
    return {
        "skills": skills,
        "categories": CATEGORIES,
        "canSchedule": schedule_limit_for_plan(plan) > 0,
    }


@skills_router.post("/{skill_id}")
async def add_skill(
    skill_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    backend = _require(d1)
    skill = get_skill(skill_id)
    if skill is None or skill["kind"] != "routine":
        raise HTTPException(status_code=404, detail="No routine skill with that id")
    existing = await backend.store.fetch_one(
        "SELECT id FROM schedules WHERE user_id = ? AND skill_id = ? LIMIT 1",
        [user.id, skill_id],
    )
    if existing:
        raise HTTPException(status_code=409, detail="You already added this skill")
    capacity = await schedules_d1.ensure_schedule_capacity(backend, _quota_user(user))
    if not capacity.get("ok"):
        return JSONResponse(
            capacity.get("body", {"error": "Scheduling is not available"}),
            status_code=int(capacity.get("status", 403)),
        )
    try:
        body = await request.json()
    except ValueError:
        body = {}
    requested = body.get("timezone") if isinstance(body, dict) else None
    tz = (
        requested
        if isinstance(requested, str) and requested and zone(requested).key == requested
        else DEFAULT_TIMEZONE
    )
    when = skill["schedule"]
    schedule_type = str(validate_schedule_input(when)["scheduleType"])
    created = await schedules_d1.create_schedule(
        backend, user.id,
        schedule=when, schedule_type=schedule_type, prompt=skill["prompt"],
        deliver_to=["telegram"], enabled=True,
        next_run_at=compute_next_run(schedule_type, when, tz=tz),
        timezone=tz, skill_id=skill_id,
    )
    return {"schedule": created}


@skills_router.delete("/{skill_id}")
async def remove_skill(
    skill_id: str,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    backend = _require(d1)
    results = await backend.store.atomic([
        Statement(
            "DELETE FROM schedules WHERE user_id = ? AND skill_id = ? RETURNING id",
            [user.id, skill_id],
        )
    ])
    if not (results and results[0].get("results")):
        raise HTTPException(status_code=404, detail="That skill isn't added")
    return {"ok": True}
