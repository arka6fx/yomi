"""User-facing, redacted activity for autonomous agent runs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.db.models_auth import User
from yomi.services import runs_d1
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend

agent_runs_router = APIRouter(prefix="/api/agent/runs")


@agent_runs_router.get("")
async def list_agent_runs(
    limit: int = 20,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
) -> dict:
    """Return safe run summaries; raw prompts and tool payloads stay server-side."""
    del db  # The durable run ledger currently lives in D1.
    if d1 is None:
        return {"runs": []}
    rows = await runs_d1.list_runs(d1, str(user.id), max(1, min(limit, 100)))
    return {
        "runs": [
            {
                "id": str(row["id"]),
                "platform": row.get("platform"),
                "kind": row.get("kind"),
                "status": row.get("status"),
                "plan": row.get("plan"),
                "summary": row.get("result_summary"),
                "error": row.get("error"),
                "attempts": row.get("attempts", 0),
                "durationSeconds": row.get("duration_seconds"),
                "createdAt": row.get("created_at"),
                "updatedAt": row.get("updated_at"),
                "completedAt": row.get("completed_at"),
            }
            for row in rows
        ]
    }


@agent_runs_router.get("/{run_id}")
async def get_agent_run(
    run_id: str,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
) -> dict:
    if d1 is None:
        raise HTTPException(status_code=404, detail="Run not found")
    row = await runs_d1.get_run(d1, run_id)
    if row is None or str(row.get("user_id")) != str(user.id):
        raise HTTPException(status_code=404, detail="Run not found")
    steps = await runs_d1.get_run_steps(d1, run_id)
    return {
        "run": {
            "id": str(row["id"]),
            "status": row.get("status"),
            "kind": row.get("kind"),
            "summary": row.get("result_summary"),
            "error": row.get("error"),
            "createdAt": row.get("created_at"),
            "completedAt": row.get("completed_at"),
        },
        "steps": [
            {
                "index": step.get("step_index"),
                "tool": step.get("tool_name"),
                "status": step.get("status"),
                "createdAt": step.get("created_at"),
            }
            for step in steps
        ],
    }
