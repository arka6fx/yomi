"""Database layer: async engine, session factory, and all table models."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from yomi.conf import settings

from .base import Base
from .models_app import (
    AgentMessage,
    AgentSession,
    CreditAccount,
    CreditGrant,
    CreditTransaction,
    Device,
    GeneratedSuggestion,
    MemoryEmbedding,
    MemoryEntry,
    MemoryRelation,
    MemorySource,
    PaymentRecord,
    ProcessedPaymentEvent,
    RagChunk,
    RagDocument,
    RagEmbedding,
    RagRetrievalLog,
    RagSource,
    ReferralEvent,
    Schedule,
    SuggestionDecision,
    TelegramMiniappLoginToken,
    UsageEvent,
)
from .models_app2 import (
    AiUsageEvent,
    CustomMcpServer,
    DeviceCode,
    LinkingCode,
    McpConnection,
    PendingAction,
    PlatformConnection,
    Plugin,
    PrivacyAuditEvent,
    PrivacyConsent,
    PrivacyDeletionJob,
    PrivacyExport,
    PrivacyPreference,
    TelegramLinkToken,
)
from .models_auth import (
    Account,
    Invitation,
    Member,
    Organization,
    Session,
    User,
    Verification,
)

__all__ = [
    "Base",
    "engine",
    "SessionLocal",
    "session_scope",
    "get_db_session",
    # auth
    "User",
    "Session",
    "Account",
    "Verification",
    "Organization",
    "Member",
    "Invitation",
    # app
    "Device",
    "TelegramMiniappLoginToken",
    "UsageEvent",
    "CreditAccount",
    "PaymentRecord",
    "CreditGrant",
    "CreditTransaction",
    "ReferralEvent",
    "ProcessedPaymentEvent",
    "AgentSession",
    "AgentMessage",
    "Schedule",
    "SuggestionDecision",
    "GeneratedSuggestion",
    "RagSource",
    "RagDocument",
    "RagChunk",
    "RagEmbedding",
    "RagRetrievalLog",
    "MemoryEntry",
    "MemorySource",
    "MemoryRelation",
    "MemoryEmbedding",
    "McpConnection",
    "CustomMcpServer",
    "PlatformConnection",
    "PendingAction",
    "LinkingCode",
    "TelegramLinkToken",
    "DeviceCode",
    "PrivacyConsent",
    "PrivacyPreference",
    "PrivacyExport",
    "PrivacyDeletionJob",
    "PrivacyAuditEvent",
    "AiUsageEvent",
    "Plugin",
]

engine: AsyncEngine | None = None
SessionLocal: async_sessionmaker[AsyncSession] | None = None


def _ensure_engine() -> None:
    """Lazily build the engine/sessionmaker once DATABASE_URL is available.
    Kept lazy so pure-import paths (tests, tooling) work without a .env."""
    global engine, SessionLocal
    if SessionLocal is not None:
        return
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL not set (see server/.env)")
    engine = create_async_engine(
        settings.database_url,
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

async def get_db_session() -> AsyncIterator[AsyncSession]:
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