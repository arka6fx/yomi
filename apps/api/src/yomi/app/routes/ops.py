"""Internal operations endpoints (cron sweeper, not user traffic).

Guarded by INTERNAL_API_KEY. Used by the Worker's scheduled handler to
recover orphaned agent runs (lease-expired or never-started) without
keeping the container warm between ticks.
"""

from __future__ import annotations

import hmac
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_db_session
from yomi.conf import settings
from yomi.services import billing_d1, runs_d1
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend, use_d1
from yomi.services.rag import d1_backend

ops_router = APIRouter()

SWEEP_LIMIT = 3
DRIVE_SWEEP_LIMIT = 5
logger = logging.getLogger(__name__)


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
    from yomi.services.scheduler_d1 import fire_due_schedules

    scheduled = await fire_due_schedules(d1)
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
    return {"scheduled": scheduled, "claimed": len(claimed), "processed": processed}


@ops_router.post("/internal/ai/probe")
async def workers_ai_probe(request: Request):
    """Authenticated, low-cost Workers AI probe for paid-plan operations checks."""
    if not _authorized(request):
        raise HTTPException(status_code=403, detail="forbidden")
    started = time.perf_counter()
    from yomi.services.llm import chat_completion, model_for

    try:
        data = await chat_completion(
            "fast",
            [{"role": "user", "content": "Reply with exactly YOMI_WORKERS_AI_OK"}],
            timeout=30,
        )
        content = str((data.get("choices") or [{}])[0].get("message", {}).get("content", ""))
        return {
            "status": "ok" if "YOMI_WORKERS_AI_OK" in content else "unexpected_response",
            "model": model_for("fast"),
            "latencyMs": int((time.perf_counter() - started) * 1000),
        }
    except Exception as exc:  # noqa: BLE001 — never return provider details
        logger.warning("workers AI probe failed: %s", type(exc).__name__)
        return JSONResponse(
            {"status": "error", "error": type(exc).__name__}, status_code=503
        )


@ops_router.post("/internal/rag/drive-sync")
async def drive_sync_sweep(
    request: Request,
    d1: D1Backend | None = Depends(get_d1_backend),
):
    """Advance every drive source in flight (backfill batches, then change sync)."""
    if not _authorized(request):
        raise HTTPException(status_code=403, detail="forbidden")
    if not use_d1() or d1 is None:
        return JSONResponse({"error": "drive sync requires the d1 backend"}, 501)
    from yomi.services.rag import drive as drive_rag

    sources = await d1_backend.drive_sources_for_ops(d1, limit=DRIVE_SWEEP_LIMIT)
    results: list[dict] = []
    for source in sources:
        user_id = str(source.get("user_id") or "")
        source_id = str(source.get("id") or "")
        entry: dict = {"sourceId": source_id}
        if not user_id:
            entry["skipped"] = "missing_user"
            results.append(entry)
            continue
        session, connected = await drive_rag.build_drive_session(user_id)
        if not connected:
            entry["skipped"] = "drive_not_connected"
            results.append(entry)
            continue
        try:
            if source.get("status") == "backfilling":
                outcome = await drive_rag.backfill_tick(d1, user_id, session, dict(source))
            else:
                outcome = await drive_rag.incremental_sync(d1, user_id, session, dict(source))
            entry.update(outcome)
        except Exception as exc:  # noqa: BLE001 — one source must not sink the sweep
            entry["error"] = f"{type(exc).__name__}: {exc}"
        results.append(entry)
    return {"processed": len(sources), "results": results}
