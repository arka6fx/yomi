"""Shared Yomi Postgres schema: SQLAlchemy 2 async models owned by packages/db.

Engine/session wiring is NOT here — it needs app config (DATABASE_URL), so it
lives in the backend at `yomi.db_session` (apps/backend). This package only
declares the schema so any consumer (backend, alembic, tooling) can import the
same models.

`yomi` is a PEP 420 namespace package: this distribution provides the `db`
subpackage while the backend provides `app`, `services`, etc.
"""

from __future__ import annotations

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
    ComposioConnection,
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
    "ComposioConnection",
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