"""App tables (packages/db/src/schema.ts) — part 1.

NOTE: a handful of legacy columns are declared as `uuid` in the Drizzle schema
(devices/usage_events/mcp_connections user_id); we mirror those exactly. All
other user_id columns are text like the real `user` table.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    Computed,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, uuid_pk


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    os: Mapped[str] = mapped_column(String, nullable=False)
    app_version: Mapped[str] = mapped_column(String, nullable=False)
    sidecar_url: Mapped[str | None] = mapped_column(String)
    last_seen: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class TelegramMiniappLoginToken(Base):
    __tablename__ = "telegram_miniapp_login_tokens"

    token: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime)


class UsageEvent(Base):
    __tablename__ = "usage_events"
    __table_args__ = (
        Index("usage_events_user_period_idx", "user_id", "created_at"),
        Index("usage_events_user_kind_idx", "user_id", "kind", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id"), nullable=False)
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("devices.id", ondelete="SET NULL")
    )
    kind: Mapped[str] = mapped_column(String, nullable=False)
    model: Mapped[str | None] = mapped_column(String)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    cost_cents: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    credits_charged: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'done'"))
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class CreditAccount(Base):
    __tablename__ = "credit_accounts"

    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), primary_key=True)
    available_credits: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    lifetime_granted: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    lifetime_consumed: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    lifetime_refunded: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class PaymentRecord(Base):
    __tablename__ = "payment_records"
    __table_args__ = (
        Index("payment_records_user_idx", "user_id", "created_at"),
        UniqueConstraint(
            "provider", "provider_payment_id", name="payment_records_provider_payment_unique"
        ),
        UniqueConstraint("provider", "provider_order_id", name="payment_records_provider_order_unique"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    product_key: Mapped[str] = mapped_column(String, nullable=False)
    provider_customer_id: Mapped[str | None] = mapped_column(String)
    provider_order_id: Mapped[str | None] = mapped_column(String)
    provider_payment_id: Mapped[str | None] = mapped_column(String)
    provider_subscription_id: Mapped[str | None] = mapped_column(String)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    currency: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'USD'"))
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'created'"))
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class CreditGrant(Base):
    __tablename__ = "credit_grants"
    __table_args__ = (
        Index("credit_grants_user_status_idx", "user_id", "status", "expires_at"),
        UniqueConstraint("source", "source_id", name="credit_grants_source_unique"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    payment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("payment_records.id"))
    source: Mapped[str] = mapped_column(String, nullable=False)
    source_id: Mapped[str] = mapped_column(String, nullable=False)
    credits_granted: Mapped[int] = mapped_column(Integer, nullable=False)
    credits_remaining: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'active'"))
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class CreditTransaction(Base):
    __tablename__ = "credit_transactions"
    __table_args__ = (
        Index("credit_transactions_user_created_idx", "user_id", "created_at"),
        UniqueConstraint("idempotency_key", name="credit_transactions_idempotency_unique"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    grant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("credit_grants.id"))
    usage_event_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("usage_events.id", ondelete="SET NULL")
    )
    payment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("payment_records.id"))
    type: Mapped[str] = mapped_column(String, nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String, nullable=False)
    reason: Mapped[str | None] = mapped_column(String)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class ReferralEvent(Base):
    __tablename__ = "referral_events"
    __table_args__ = (
        Index("referral_events_referrer_user_id_idx", "referrer_user_id"),
        UniqueConstraint("referred_user_id", name="referral_events_referred_user_id_unique"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    referrer_user_id: Mapped[str] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    referred_user_id: Mapped[str] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    credits_granted: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class ProcessedPaymentEvent(Base):
    __tablename__ = "processed_payment_events"
    __table_args__ = (
        UniqueConstraint(
            "provider", "event_id", name="processed_payment_events_provider_event_unique"
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    provider: Mapped[str] = mapped_column(String, nullable=False)
    event_id: Mapped[str] = mapped_column(String, nullable=False)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    payload_hash: Mapped[str] = mapped_column(String, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class AgentSession(Base):
    __tablename__ = "agent_sessions"
    __table_args__ = (
        Index("agent_sessions_user_platform_idx", "user_id", "platform", "chat_id"),
        Index("agent_sessions_user_status_idx", "user_id", "status", "last_message_at"),
        Index(
            "agent_sessions_tsv_idx",
            "summary_tsv",
            postgresql_using="gin",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    platform: Mapped[str] = mapped_column(String, nullable=False)
    chat_id: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str | None] = mapped_column(String)
    summary: Mapped[str | None] = mapped_column(String)
    summary_tsv: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(
            "to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, ''))",
            persisted=True,
        ),
    )
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'active'"))
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    last_message_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime)


class AgentMessage(Base):
    __tablename__ = "agent_messages"
    __table_args__ = (
        Index("agent_messages_session_created_idx", "session_id", "created_at"),
        Index("agent_messages_user_created_idx", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_sessions.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(String, nullable=False)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class Schedule(Base):
    __tablename__ = "schedules"
    __table_args__ = (
        Index("schedules_user_idx", "user_id"),
        Index("schedules_due_idx", "enabled", "next_run_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    schedule: Mapped[str] = mapped_column(String, nullable=False)
    schedule_type: Mapped[str] = mapped_column(String, nullable=False)
    prompt: Mapped[str] = mapped_column(String, nullable=False)
    deliver_to: Mapped[list | None] = mapped_column(JSONB)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    one_shot: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_run_status: Mapped[str | None] = mapped_column(String)
    last_run_error: Mapped[str | None] = mapped_column(String)
    run_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class SuggestionDecision(Base):
    __tablename__ = "suggestion_decisions"
    __table_args__ = (
        Index("suggestion_decisions_user_idx", "user_id"),
        UniqueConstraint("user_id", "dedup_key", name="suggestion_decisions_user_key_unique"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    dedup_key: Mapped[str] = mapped_column(String, nullable=False)
    decision: Mapped[str] = mapped_column(String, nullable=False)
    schedule_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("schedules.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class GeneratedSuggestion(Base):
    __tablename__ = "generated_suggestions"
    __table_args__ = (
        Index("generated_suggestions_user_idx", "user_id"),
        UniqueConstraint("user_id", "dedup_key", name="generated_suggestions_user_key_unique"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    dedup_key: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False)
    schedule: Mapped[str] = mapped_column(String, nullable=False)
    prompt: Mapped[str] = mapped_column(String, nullable=False)
    deliver_to: Mapped[list | None] = mapped_column(JSONB)
    connector: Mapped[str] = mapped_column(String, nullable=False)
    time_bucket: Mapped[str] = mapped_column(String, nullable=False)
    distinct_days: Mapped[int] = mapped_column(Integer, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class RagSource(Base):
    __tablename__ = "rag_sources"
    __table_args__ = (
        Index("rag_sources_user_idx", "user_id"),
        UniqueConstraint("user_id", "path", name="rag_sources_user_path_unique"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    path: Mapped[str | None] = mapped_column(String)
    content_hash: Mapped[str | None] = mapped_column(String)
    source_type: Mapped[str] = mapped_column(String, nullable=False)
    privacy_scope: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'cloud_rag'")
    )
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'indexing'"))
    sync_state: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class RagDocument(Base):
    __tablename__ = "rag_documents"
    __table_args__ = (
        Index("rag_documents_user_idx", "user_id"),
        Index("rag_documents_source_idx", "source_id"),
        UniqueConstraint("source_id", "content_hash", name="rag_documents_source_hash_unique"),
        Index("rag_documents_source_external_idx", "source_id", "external_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rag_sources.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    mime_type: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'text/plain'"))
    content_hash: Mapped[str] = mapped_column(String, nullable=False)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    external_id: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class RagChunk(Base):
    __tablename__ = "rag_chunks"
    __table_args__ = (
        Index("rag_chunks_user_idx", "user_id"),
        Index("rag_chunks_document_idx", "document_id"),
        Index("rag_chunks_tsv_idx", "content_tsv", postgresql_using="gin"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rag_documents.id", ondelete="CASCADE"), nullable=False
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(String, nullable=False)
    content_tsv: Mapped[str | None] = mapped_column(
        TSVECTOR, Computed("to_tsvector('english', content)", persisted=True)
    )
    token_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class RagEmbedding(Base):
    __tablename__ = "rag_embeddings"
    __table_args__ = (
        Index("rag_embeddings_user_idx", "user_id"),
        Index("rag_embeddings_chunk_idx", "chunk_id"),
        Index(
            "rag_embeddings_vector_idx",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    chunk_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rag_chunks.id", ondelete="CASCADE"), nullable=False
    )
    model: Mapped[str] = mapped_column(String, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(1536), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class RagRetrievalLog(Base):
    __tablename__ = "rag_retrieval_logs"
    __table_args__ = (Index("rag_retrieval_logs_user_idx", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    query_hash: Mapped[str] = mapped_column(String, nullable=False)
    matched_chunk_ids: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class MemoryEntry(Base):
    __tablename__ = "memory_entries"
    __table_args__ = (
        Index("memory_entries_user_status_idx", "user_id", "status", "updated_at"),
        Index("memory_entries_user_topic_idx", "user_id", "topic"),
        UniqueConstraint("user_id", "custom_id", name="memory_entries_user_custom_unique"),
        Index("memory_entries_user_hash_idx", "user_id", "content_hash"),
        Index("memory_entries_tsv_idx", "content_tsv", postgresql_using="gin"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    custom_id: Mapped[str | None] = mapped_column(String)
    content_hash: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'fact'"))
    scope: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'global'"))
    topic: Mapped[str] = mapped_column(String, nullable=False)
    summary: Mapped[str | None] = mapped_column(String)
    content: Mapped[str] = mapped_column(String, nullable=False)
    content_tsv: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(
            "setweight(to_tsvector('english', coalesce(topic, '')), 'A') || "
            "setweight(to_tsvector('english', coalesce(summary, '')), 'B') || "
            "setweight(to_tsvector('english', coalesce(content, '')), 'C') || "
            "setweight(to_tsvector('english', "
            "coalesce(kind, '') || ' ' || coalesce(scope, '')), 'D')",
            persisted=True,
        ),
    )
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'active'"))
    confidence: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("70"))
    source_type: Mapped[str | None] = mapped_column(String)
    source_path: Mapped[str | None] = mapped_column(String)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    is_latest: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    is_static: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    root_memory_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    parent_memory_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    forget_after: Mapped[datetime | None] = mapped_column(DateTime)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class MemorySource(Base):
    __tablename__ = "memory_sources"
    __table_args__ = (Index("memory_sources_memory_idx", "memory_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    memory_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("memory_entries.id", ondelete="CASCADE"), nullable=False
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("rag_documents.id", ondelete="SET NULL")
    )
    chunk_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("rag_chunks.id", ondelete="SET NULL"))
    source_path: Mapped[str | None] = mapped_column(String)
    relevance: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("100"))
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class MemoryRelation(Base):
    __tablename__ = "memory_relations"
    __table_args__ = (
        Index("memory_relations_user_from_idx", "user_id", "from_memory_id"),
        UniqueConstraint(
            "from_memory_id", "to_memory_id", "relation_type", name="memory_relations_unique"
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    from_memory_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("memory_entries.id", ondelete="CASCADE"), nullable=False
    )
    to_memory_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("memory_entries.id", ondelete="CASCADE"), nullable=False
    )
    relation_type: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class MemoryEmbedding(Base):
    __tablename__ = "memory_embeddings"
    __table_args__ = (
        Index("memory_embeddings_user_idx", "user_id"),
        Index("memory_embeddings_memory_idx", "memory_id"),
        Index(
            "memory_embeddings_vector_idx",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    memory_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("memory_entries.id", ondelete="CASCADE"), nullable=False
    )
    model: Mapped[str] = mapped_column(String, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(1536), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())