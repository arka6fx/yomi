"""Async engine/session wiring for the Yomi Postgres schema.

The models themselves live in the shared `packages/db` distribution (`yomi.db`).
This module owns the parts that need app config — the engine, sessionmaker, and
the FastAPI dependency that yields a committed session — so the shared schema
stays free of `yomi.conf` coupling.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from yomi.conf import settings

engine: AsyncEngine | None = None
SessionLocal: async_sessionmaker[AsyncSession] | None = None


def asyncpg_database_url(url: str) -> str:
    """Normalize a Neon ``DATABASE_URL`` for the asyncpg engine.

    Adds the ``+asyncpg`` driver to plain ``postgres://``/``postgresql://``
    schemes (create_async_engine would otherwise fall back to psycopg2) and
    rewrites ``sslmode=require`` (psycopg2 spelling, used by Neon's defaults)
    to ``ssl=require`` (the asyncpg dialect kwarg).
    """
    parts = urlsplit(url)
    scheme = parts.scheme or ""
    if not scheme.startswith("postgres"):
        return url
    if "+asyncpg" not in scheme:
        scheme = f"{scheme}+asyncpg"
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    if "ssl" not in query and query.get("sslmode") in ("require", "verify-ca", "verify-full"):
        ssl = query.pop("sslmode")
        query["ssl"] = "require" if ssl == "require" else ssl
    return urlunsplit((scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def _ensure_engine() -> None:
    """Lazily build the engine/sessionmaker once DATABASE_URL is available.
    Kept lazy so pure-import paths (tests, tooling) work without a .env."""
    global engine, SessionLocal
    if SessionLocal is not None:
        return
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL not set (see apps/backend/.env)")
    # Point DATABASE_URL at Neon's DIRECT host, not the -pooler host: asyncpg
    # uses server-side prepared statements, which pgbouncer transaction-mode
    # probing rejects (statement_cache_size=0 would be required otherwise).
    engine = create_async_engine(
        asyncpg_database_url(settings.database_url),
        pool_pre_ping=True,
        pool_recycle=1800,
    )
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Session that commits on success and rolls back on error."""
    _ensure_engine()
    assert SessionLocal is not None
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


class _UnavailableSession:
    """Dependency placeholder when Postgres is unconfigured in D1 mode.

    Routes in D1 mode never touch the Postgres session; resolving the
    dependency must not fail. Any actual use raises loudly instead of
    silently misbehaving.
    """

    def __getattr__(self, name: str) -> Any:
        raise RuntimeError(f"Postgres session is unavailable (storage_backend=d1): {name}")


async def get_db_session() -> AsyncIterator[AsyncSession]:
    if not settings.database_url and settings.storage_backend == "d1":
        yield _UnavailableSession()  # type: ignore[misc]
        return
    _ensure_engine()
    assert SessionLocal is not None
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def check_connection(db: AsyncSession) -> bool:
    """Best-effort connectivity check for the /api/status aggregate."""
    try:
        await db.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


async def create_missing_tables() -> None:
    """Idempotently create any tables the python schema owns that prod is missing.

    The shared ``platform_connections`` / ``composio_connections`` tables are
    owned by the retired TS drizzle rollup and already exist in Neon, but newer
    python-only models (``telegram_link_tokens``) ship with no alembic/drizzle
    migration. ``Base.metadata.create_all(checkfirst=True)`` creates only tables
    that are absent and never alters or drops existing ones — safe to run on the
    shared schema at every boot and a no-op once all tables exist.
    """
    from yomi.db_session import SessionLocal

    if SessionLocal is None:
        raise RuntimeError("cannot bootstrap schema: db session not initialised")
    from yomi.db import Base  # noqa: PLC0415 — module-level import would create app/conf coupling

    async with SessionLocal() as session:
        await session.run_sync(Base.metadata.create_all)