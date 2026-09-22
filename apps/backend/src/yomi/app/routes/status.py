"""/api/status — the Cloud "Status" panel aggregate.

Port of apps/backend/src/routes/status.ts. Best-effort: a failure in any one
section degrades to a warning rather than failing the whole response.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Literal, TypedDict

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.db.models_app import Schedule
from yomi.db.models_app2 import McpConnection, PlatformConnection
from yomi.db.models_auth import User
from yomi.services import billing_d1
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend
from yomi.services.cloudflare_storage.store import parse_dt as _parse_dt
from yomi.services.credit_ledger import get_credit_summary
from yomi.services.entitlements import (
    effective_plan_for_user,
    get_plan_config,
    has_billable_plan_access,
)

logger = logging.getLogger(__name__)

status_router = APIRouter(prefix="/api/status")

CheckLevel = Literal["ok", "warn", "down"]


class Check(TypedDict):
    id: str
    label: str
    level: CheckLevel
    detail: str


def _to_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


@status_router.get("")
async def status_panel(
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
) -> dict:
    ctx = vars_dict(user)
    plan = effective_plan_for_user(ctx)
    plan_config = get_plan_config(ctx)
    plan_name = plan_config["name"]
    checks: list[Check] = []

    # Gateway — the Python port doesn't run the messaging gateway yet, so it
    # reports the TS fallback shape until that phase lands.
    gateway = {"running": False, "activeSessions": 0, "adapters": []}
    checks.append(
        {
            "id": "gateway",
            "label": "Messaging gateway",
            "level": "ok" if gateway["running"] else "warn",
            "detail": "Online · 0 adapters" if gateway["running"] else "Starts on first request",
        }
    )

    # Plan / billing access
    billing_access = has_billable_plan_access(vars_dict(user))
    checks.append(
        {
            "id": "plan",
            "label": "Plan access",
            "level": "ok" if billing_access else "down",
            "detail": f"{plan_name} · active"
            if billing_access
            else (
                "Trial ended — subscribe to continue"
                if plan == "explore"
                else "Billing inactive — payment needed"
            ),
        }
    )

    # Credits
    balance = 0
    try:
        if d1 is not None:
            summary = await billing_d1.get_credit_summary(d1, user.id)
        else:
            summary = await get_credit_summary(session, user.id)
        balance = summary.balance
    except Exception:  # noqa: BLE001 — best-effort, leave balance at 0
        pass
    checks.append(
        {
            "id": "credits",
            "label": "Credits",
            "level": "ok" if balance > 0 else "warn",
            "detail": f"{balance} available",
        }
    )

    # Telegram link
    telegram: dict[str, object] = {"connected": False, "linkedAt": None}
    try:
        if d1 is not None:
            link = await d1.store.fetch_one(
                "SELECT connected_at FROM platform_connections "
                "WHERE user_id = ? AND platform = 'telegram' "
                "ORDER BY connected_at DESC LIMIT 1",
                [user.id],
            )
            linked_at = (link or {}).get("connected_at")
        else:
            link = (
                await session.execute(
                    select(PlatformConnection.connected_at)
                    .where(
                        PlatformConnection.user_id == user.id,
                        PlatformConnection.platform == "telegram",
                    )
                    .order_by(PlatformConnection.connected_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            linked_at = link.isoformat() if link else None
        telegram = {
            "connected": bool(linked_at),
            "linkedAt": linked_at,
        }
    except Exception:  # noqa: BLE001 — best-effort
        pass
    checks.append(
        {
            "id": "telegram",
            "label": "Telegram",
            "level": "ok" if telegram["connected"] else "warn",
            "detail": "Linked" if telegram["connected"] else "Not connected",
        }
    )

    # Connectors (display names resolve to the provider id until the connector
    # registry is ported).
    connectors: dict[str, object] = {"total": 0, "needsReconnect": []}
    try:
        if d1 is not None:
            conn_rows = await d1.store.fetch_all(
                "SELECT provider, expires_at FROM mcp_connections WHERE user_id = ?",
                [user.id],
            )
            now = datetime.now(UTC)
            needs_reconnect = []
            for row in conn_rows:
                expires_at = row.get("expires_at")
                if expires_at is not None:
                    moment = _parse_dt(expires_at)
                    if moment is not None and moment < now:
                        needs_reconnect.append(
                            {"provider": row["provider"], "displayName": row["provider"]}
                        )
            connectors = {"total": len(conn_rows), "needsReconnect": needs_reconnect}
        else:
            rows = (
                await session.execute(
                    select(McpConnection.provider, McpConnection.expires_at).where(
                        McpConnection.user_id == user.id
                    )
                )
            ).all()
            now = datetime.now(UTC)
            needs_reconnect = [
                {"provider": r.provider, "displayName": r.provider}
                for r in rows
                if r.expires_at is not None and _to_datetime(r.expires_at) < now
            ]
            connectors = {"total": len(rows), "needsReconnect": needs_reconnect}
    except Exception:  # noqa: BLE001 — best-effort
        pass
    needs = connectors["needsReconnect"]
    total = connectors["total"]
    checks.append(
        {
            "id": "connectors",
            "label": "App connectors",
            "level": "warn" if needs else "ok",
            "detail": (
                "None connected"
                if total == 0
                else f"{len(needs)} need reconnecting" if needs else f"{total} healthy"
            ),
        }
    )

    # Schedules
    schedule_info: dict[str, object] = {"total": 0, "enabled": 0, "nextRunAt": None}
    try:
        if d1 is not None:
            sched_rows = await d1.store.fetch_all(
                "SELECT enabled, next_run_at FROM schedules WHERE user_id = ?", [user.id]
            )
            enabled_rows = [r for r in sched_rows if r.get("enabled")]
            next_runs = sorted(
                str(r["next_run_at"]) for r in enabled_rows if r.get("next_run_at")
            )
            schedule_info = {
                "total": len(sched_rows),
                "enabled": len(enabled_rows),
                "nextRunAt": next_runs[0] if next_runs else None,
            }
        else:
            row = (
                await session.execute(
                    select(
                        func.count().label("total"),
                        func.count().filter(Schedule.enabled).label("enabled"),
                        func.min(Schedule.next_run_at)
                        .filter(Schedule.enabled)
                        .label("next_run_at"),
                    ).where(Schedule.user_id == user.id)
                )
            ).one()
            next_run = row.next_run_at
            schedule_info = {
                "total": int(row.total or 0),
                "enabled": int(row.enabled or 0),
                "nextRunAt": next_run.isoformat() if next_run else None,
            }
    except Exception:  # noqa: BLE001 — table may be empty
        pass
    checks.append(
        {
            "id": "schedules",
            "label": "Scheduled tasks",
            "level": "ok",
            "detail": (
                f"{schedule_info['enabled']} active"
                if schedule_info["enabled"]
                else "All paused"
                if schedule_info["total"]
                else "None scheduled"
            ),
        }
    )

    worst: CheckLevel = (
        "down"
        if any(ch["level"] == "down" for ch in checks)
        else "warn"
        if any(ch["level"] == "warn" for ch in checks)
        else "ok"
    )

    return {
        "overall": worst,
        "generatedAt": datetime.now(UTC).isoformat(),
        "plan": {
            "plan": plan,
            "name": plan_name,
            "status": user.subscription_status or "inactive",
            "billingAccess": billing_access,
        },
        "credits": {"balance": balance},
        "gateway": gateway,
        "telegram": telegram,
        "connectors": connectors,
        "schedules": schedule_info,
        "checks": checks,
    }


def vars_dict(user: User) -> dict[str, object]:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "plan": user.plan,
        "subscription_status": user.subscription_status,
        "current_period_end": user.current_period_end,
        "trial_end_date": user.trial_end_date,
    }