"""Schedule capacity gate — shared by POST /api/schedules and suggestion accepts.

Port of apps/backend/src/services/schedule-quota.ts.
"""

from __future__ import annotations

from typing import TypedDict

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.db.models_app import Schedule
from yomi.services.entitlements import effective_plan_for_user, get_plan_config
from yomi.services.schedule_parser import schedule_limit_for_plan


# Structurally matches entitlements' EntitlementUser plus the required id.
class QuotaUser(TypedDict, total=False):
    id: str | None
    email: str | None
    role: str | None
    plan: str | None


class CapacityDenied(TypedDict):
    status: int
    body: dict[str, str]


CapacityResult = dict[str, object] | CapacityDenied


# The single plan gate for creating a schedule — shared by POST /api/schedules
# and suggestion accepts so the two paths can never drift.
async def ensure_schedule_capacity(
    session: AsyncSession, user: QuotaUser
) -> CapacityResult:
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
    result = await session.execute(
        select(func.count()).select_from(Schedule).where(Schedule.user_id == user_id)
    )
    count = int(result.scalar_one())
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