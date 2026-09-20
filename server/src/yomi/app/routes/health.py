"""/health and /health/db — liveness + schema-drift observability.

Port of apps/backend/src/index.ts health endpoints. Deploys ship code
automatically but migrations run manually, so drift is the recurring cause of
production 42703 errors.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app import __version__
from yomi.app.deps import get_db_session

logger = logging.getLogger(__name__)

health_router = APIRouter()

# Snapshot of the migration journal at port time (packages/db). Drizzle's migrator
# applies an entry only when its `when` exceeds the max recorded created_at, so
# drift is detected by timestamp, not row count.
EXPECTED_LATEST_WHEN = 1787011200000
EXPECTED_LATEST_TAG = "0042_drop_custom_avatar_key"


@health_router.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": __version__}


@health_router.get("/health/db")
async def health_db(session: AsyncSession = Depends(get_db_session)) -> JSONResponse:
    try:
        row = (
            await session.execute(
                text(
                    "select coalesce(max(created_at), 0)::bigint as latest, "
                    "count(*)::int as count from drizzle.__drizzle_migrations"
                )
            )
        ).one()
        latest_applied = int(row.latest)
        applied = int(row.count)
        body = {
            "applied": applied,
            "latestApplied": latest_applied,
            "latestExpected": EXPECTED_LATEST_WHEN,
            "latestTag": EXPECTED_LATEST_TAG,
        }
        if latest_applied < EXPECTED_LATEST_WHEN:
            logger.error(
                "[health/db] schema drift: latest applied %d < expected %d (%s)",
                latest_applied,
                EXPECTED_LATEST_WHEN,
                EXPECTED_LATEST_TAG,
            )
            return JSONResponse({"status": "behind", **body}, status_code=503)
        return JSONResponse({"status": "ok", **body})
    except Exception as exc:  # noqa: BLE001 — health check must always return a shape
        logger.error("[health/db] check failed: %s", exc)
        return JSONResponse({"status": "error", "error": "db check failed"}, status_code=503)