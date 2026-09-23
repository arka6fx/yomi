"""Internal operations endpoints (cron sweeper, not user traffic).

Guarded by INTERNAL_API_KEY. Used by the Worker's scheduled handler to
recover orphaned agent runs (lease-expired or never-started) without
keeping the container warm between ticks.
"""

from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_db_session
from yomi.conf import settings
from yomi.services import billing_d1, runs_d1
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend, use_d1

ops_router = APIRouter()

SWEEP_LIMIT = 3


def _authorized(request: Request) -> bool:
    expected = settings.internal_api_key
    if not expected:
        return False
    provided = request.headers.get("x-yomi-internal", "")
    return hmac.compare_digest(provided, expected)


@ops_router.post("/internal/dispatch")
async def dispatch_sweep(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if not _authorized(request):
        raise HTTPException(status_code=403, detail="forbidden")
    if not use_d1() or d1 is None:
        return JSONResponse({"error": "run ledger requires the d1 backend"}, 501)
    from yomi.gateway.telegram import execute_telegram_run

    owner = f"sweep-{id(request):x}"
    claimed = await runs_d1.claim_due_runs(d1, owner, limit=SWEEP_LIMIT)
    processed = 0
    for run in claimed:
        user = await billing_d1.load_metering_user(d1, str(run["user_id"]))
        if user is None:
            await runs_d1.fail_run(d1, str(run["id"]), "user not found")
            continue
        try:
            await execute_telegram_run(
                d1, dict(user), str(run["chat_id"]),
                run.get("message_id") if isinstance(run.get("message_id"), int) else None,
                str(run.get("input_text") or ""),
                str(run.get("kind") or "chat"),
                run.get("duration_seconds"),
                str(run["id"]),
                str(run.get("plan") or "explore"),
            )
            processed += 1
        except Exception as exc:  # noqa: BLE001 — one bad run must not sink the sweep
            await runs_d1.fail_run(d1, str(run["id"]), f"{type(exc).__name__}: {exc}")
    return {"claimed": len(claimed), "processed": processed}
