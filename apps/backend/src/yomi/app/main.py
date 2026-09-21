"""FastAPI entry point — mirrors apps/backend/src/index.ts mounts.

Serves /health, /health/db, robots.txt, and the /api/* routers. Auth (/api/auth/*)
is a Python port of the retired Better Auth TS config (OAuth Google/GitHub +
sessions), wire-compatible with the @better-auth/react dashboard client; the
session seam lives in yomi/app/deps + yomi/services/session_cookie.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from yomi.app import __version__
from yomi.app.routes.billing import billing_router
from yomi.app.routes.health import health_router
from yomi.app.routes.llm import llm_router
from yomi.app.routes.memory import memory_router
from yomi.app.routes.privacy import privacy_router
from yomi.app.routes.profile import profile_router
from yomi.app.routes.rag import rag_router
from yomi.app.routes.referrals import referrals_router
from yomi.app.routes.schedules import schedules_router
from yomi.app.routes.status import status_router
from yomi.app.routes.streaks import streaks_router
from yomi.app.routes.usage import usage_router
from yomi.conf import settings
from yomi.logging import get_logger

logger = get_logger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    from yomi.db_session import check_connection, get_db_session

    if not settings.database_url:
        logger.warning("DATABASE_URL not set — DB-dependent routes will fail.")
    else:
        try:
            async with get_db_session() as s:
                ok = await check_connection(s)
            logger.warning("[startup] db connection %s", "ok" if ok else "FAILED")
            if ok:
                from yomi.db_session import create_missing_tables

                await create_missing_tables()
                logger.warning("[startup] missing tables ensured")
        except Exception as exc:  # noqa: BLE001 — startup must not crash on a bad DB
            logger.warning("[startup] db connection failed: %s", exc)

    from yomi.connectors.composio import ensure_webhook_subscription

    try:
        subscription = await ensure_webhook_subscription()
        if subscription:
            logger.info("[startup] composio webhook subscribed: %s", subscription)
    except Exception as exc:  # noqa: BLE001 — startup must not crash on a bad key
        logger.warning("[startup] composio webhook subscription skipped: %s", exc)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Yomi API", version=__version__, lifespan=_lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.cors_origin] if settings.cors_origin else [],
        allow_credentials=True,
        allow_methods=["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    app.include_router(health_router)
    app.include_router(usage_router)
    app.include_router(status_router)
    app.include_router(profile_router)
    app.include_router(billing_router)
    app.include_router(llm_router)
    app.include_router(rag_router)
    app.include_router(referrals_router)
    app.include_router(streaks_router)
    app.include_router(privacy_router)
    app.include_router(schedules_router)
    app.include_router(memory_router)

    from yomi.app.routes.auth import router as auth_router
    app.include_router(auth_router, prefix="/api/auth")

    from yomi.app.routes.integrations import integrations_router
    app.include_router(integrations_router)
    from yomi.app.routes.webhooks import webhooks_router
    app.include_router(webhooks_router)

    from yomi.gateway.routes import router as gateway_router
    app.include_router(gateway_router, prefix="/api/gateway")

    # Assuming these exist or will exist later as per instructions
    try:
        from yomi.app.routes.actions import actions_router
        from yomi.app.routes.conversation import conversation_router
        from yomi.app.routes.history import history_router
        from yomi.app.routes.suggestions import suggestions_router
        app.include_router(suggestions_router)
        app.include_router(actions_router)
        app.include_router(conversation_router)
        app.include_router(history_router)
    except ImportError:
        pass

    @app.get("/robots.txt", include_in_schema=False)
    async def robots() -> PlainTextResponse:
        return PlainTextResponse("User-agent: *\nDisallow: /\n")

    return app


app = create_app()