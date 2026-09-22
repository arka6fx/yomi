""""/health and /health/db — liveness + schema-drift observability.

/health/db checks the active backend: the drizzle migration journal on
Postgres, or the D1 migrations table plus core-table presence on D1.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from yomi.app import __version__
from yomi.app.deps import get_db_session
from yomi.conf import settings
from yomi.services.cloudflare_storage.deps import use_d1

logger = logging.getLogger(__name__)

health_router = APIRouter()

# Snapshot of the migration journal at port time (packages/db). Drizzle's migrator
# applies an entry only when its `when` exceeds the max recorded created_at, so
# drift is detected by timestamp, not row count.
EXPECTED_LATEST_WHEN = 1787011200000
EXPECTED_LATEST_TAG = "0042_drop_custom_avatar_key"

# D1 migration journal table + a core table that must exist past migration 0001.
D1_MIGRATIONS_TABLE = "d1_migrations"
D1_CORE_TABLES = ("user", "memory_entries", "credit_accounts", "vector_sync_outbox")


@health_router.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": __version__}


async def _d1_health() -> JSONResponse:
    if not settings.storage_gateway_url or not settings.storage_gateway_secret:
        return JSONResponse({"status": "error", "error": "storage gateway not configured"}, 503)
    try:
        async with httpx.AsyncClient() as http:
            from yomi.services.cloudflare_storage.client import StorageClient
            from yomi.services.cloudflare_storage.store import D1Store

            store = D1Store(StorageClient.configured(http))
            tables = await store.fetch_all(
                "SELECT name FROM sqlite_master WHERE type = 'table'", []
            )
            names = {str(row["name"]) for row in tables}
            missing = [table for table in D1_CORE_TABLES if table not in names]
            if missing:
                logger.error("[health/db] d1 schema drift: missing tables %s", missing)
                return JSONResponse({"status": "behind", "missingTables": missing}, 503)
            journal = await store.fetch_all(
                f"SELECT name FROM {D1_MIGRATIONS_TABLE} ORDER BY name DESC LIMIT 5", []
            )
            applied = [str(row["name"]) for row in journal]
            body = {"applied": applied, "tableCount": len(names)}
            if "0001_initial.sql" not in applied:
                logger.error("[health/db] d1 migrations not applied: %s", applied)
                return JSONResponse({"status": "behind", **body}, 503)
            return JSONResponse({"status": "ok", **body})
    except Exception as exc:  # noqa: BLE001 — health check must always return a shape
        logger.error("[health/db] d1 check failed: %s", type(exc).__name__)
        return JSONResponse(
            {"status": "error", "error": "db check failed", "detail": type(exc).__name__},
            503,
        )


@health_router.get("/health/db")
async def health_db() -> JSONResponse:
    if use_d1():
        return await _d1_health()
    try:
        async for session in get_db_session():
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