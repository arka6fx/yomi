"""App tables (packages/db/src/schema.ts) — part 2."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, uuid_pk


class McpConnection(Base):
    __tablename__ = "mcp_connections"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="mcp_connections_user_provider_unique"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    # Stale-but-live: pre-existing column is uuid while the real user.id is text.
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id"), nullable=False)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    oauth_tokens: Mapped[str] = mapped_column(String, nullable=False)
    scopes: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class CustomMcpServer(Base):
    __tablename__ = "custom_mcp_servers"
    __table_args__ = (
        UniqueConstraint("user_id", "url", name="custom_mcp_servers_user_url_unique"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    url: Mapped[str] = mapped_column(String, nullable=False)
    api_key_encrypted: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class PlatformConnection(Base):
    __tablename__ = "platform_connections"
    __table_args__ = (
        UniqueConstraint(
            "platform", "platform_user_id", name="platform_connections_platform_user_unique"
        ),
        Index("platform_connections_user_idx", "user_id"),
        Index("platform_connections_platform_idx", "platform", "platform_user_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    platform: Mapped[str] = mapped_column(String, nullable=False)
    platform_user_id: Mapped[str] = mapped_column(String, nullable=False)
    platform_chat_id: Mapped[str | None] = mapped_column(String)
    connected_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class PendingAction(Base):
    __tablename__ = "pending_actions"
    __table_args__ = (
        Index("pending_actions_user_status_idx", "user_id", "status", "created_at"),
        Index("pending_actions_expires_idx", "status", "expires_at"),
        Index("pending_actions_connector_action_idx", "connector", "action"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    connector: Mapped[str] = mapped_column(String, nullable=False)
    action: Mapped[str] = mapped_column(String, nullable=False)
    risk: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    preview: Mapped[str] = mapped_column(String, nullable=False)
    confirm_text: Mapped[str | None] = mapped_column(String)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'pending'"))
    result: Mapped[dict | None] = mapped_column(JSONB)
    source_platform: Mapped[str | None] = mapped_column(String)
    source_chat_id: Mapped[str | None] = mapped_column(String)
    requested_by_run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class LinkingCode(Base):
    __tablename__ = "linking_codes"

    code: Mapped[str] = mapped_column(String, primary_key=True)
    platform: Mapped[str] = mapped_column(String, nullable=False)
    platform_user_id: Mapped[str] = mapped_column(String, nullable=False)
    platform_chat_id: Mapped[str | None] = mapped_column(String)
    user_id: Mapped[str | None] = mapped_column(String)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class TelegramLinkToken(Base):
    __tablename__ = "telegram_link_tokens"

    token: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    telegram_user_id: Mapped[str | None] = mapped_column(String)


class DeviceCode(Base):
    __tablename__ = "device_codes"
    __table_args__ = (
        Index("device_codes_user_code_idx", "user_code"),
        Index("device_codes_expires_at_idx", "expires_at"),
    )

    device_code: Mapped[str] = mapped_column(String, primary_key=True)
    user_code: Mapped[str] = mapped_column(String, nullable=False)
    client_id: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    token: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class PrivacyConsent(Base):
    __tablename__ = "privacy_consents"
    __table_args__ = (
        Index("privacy_consents_user_purpose_idx", "user_id", "purpose", "created_at"),
        Index("privacy_consents_user_status_idx", "user_id", "status"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    purpose: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    consent_version: Mapped[str] = mapped_column(String, nullable=False)
    privacy_policy_version: Mapped[str] = mapped_column(String, nullable=False)
    terms_version: Mapped[str] = mapped_column(String, nullable=False)
    app_version: Mapped[str | None] = mapped_column(String)
    ip_address: Mapped[str | None] = mapped_column(String)
    user_agent: Mapped[str | None] = mapped_column(String)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class PrivacyPreference(Base):
    __tablename__ = "privacy_preferences"

    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    conversation_history_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    memory_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    cloud_memory_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    connectors_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    analytics_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    voice_processing_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    ai_improvement_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    telegram_processing_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    retention_overrides: Mapped[dict | None] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class PrivacyExport(Base):
    __tablename__ = "privacy_exports"
    __table_args__ = (
        Index("privacy_exports_user_status_idx", "user_id", "status", "requested_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'queued'"))
    format: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'json'"))
    manifest: Mapped[dict | None] = mapped_column(JSONB)
    archive_url: Mapped[str | None] = mapped_column(String)
    archive_sha256: Mapped[str | None] = mapped_column(String)
    error: Mapped[str | None] = mapped_column(String)
    requested_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime)


class PrivacyDeletionJob(Base):
    __tablename__ = "privacy_deletion_jobs"
    __table_args__ = (
        Index("privacy_deletion_jobs_user_status_idx", "user_id", "status", "requested_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'queued'"))
    steps: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    error: Mapped[str | None] = mapped_column(String)
    requested_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class PrivacyAuditEvent(Base):
    __tablename__ = "privacy_audit_events"
    __table_args__ = (
        Index("privacy_audit_events_target_created_idx", "target_user_id", "created_at"),
        Index("privacy_audit_events_actor_created_idx", "actor_user_id", "created_at"),
        Index("privacy_audit_events_type_idx", "event_type", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    actor_user_id: Mapped[str | None] = mapped_column(String)
    target_user_id: Mapped[str | None] = mapped_column(String)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    resource_type: Mapped[str | None] = mapped_column(String)
    resource_id: Mapped[str | None] = mapped_column(String)
    ip_address: Mapped[str | None] = mapped_column(String)
    user_agent: Mapped[str | None] = mapped_column(String)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class AiUsageEvent(Base):
    __tablename__ = "ai_usage_events"
    __table_args__ = (
        UniqueConstraint("request_id", name="ai_usage_events_request_id_uq"),
        Index("ai_usage_events_user_created_idx", "user_id", "created_at"),
        Index("ai_usage_events_endpoint_idx", "endpoint", "created_at"),
        Index("ai_usage_events_model_idx", "model", "created_at"),
        Index("ai_usage_events_status_idx", "status"),
        Index("ai_usage_events_usage_event_idx", "usage_event_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    usage_event_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("usage_events.id", ondelete="SET NULL")
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    request_id: Mapped[str] = mapped_column(String, nullable=False)
    endpoint: Mapped[str] = mapped_column(String, nullable=False)
    surface: Mapped[str] = mapped_column(String, nullable=False)
    route: Mapped[str | None] = mapped_column(String)
    intent: Mapped[str | None] = mapped_column(String)
    complexity: Mapped[str | None] = mapped_column(String)
    model: Mapped[str | None] = mapped_column(String)
    provider: Mapped[str | None] = mapped_column(String)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    reasoning_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    cached_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    embedding_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    max_output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    tool_calls: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    connector_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    connector_ids: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, server_default=text("'{}'::text[]")
    )
    vision_images: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    voice_duration_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    tts_chars: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    stt_audio_seconds: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    first_token_latency_ms: Mapped[int | None] = mapped_column(Integer)
    total_api_cost_micros: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    credit_policy_version: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'static-v1'")
    )
    credits_estimated: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    credits_charged: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'started'"))
    error_code: Mapped[str | None] = mapped_column(String)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class Plugin(Base):
    __tablename__ = "plugins"
    __table_args__ = (UniqueConstraint("plugin_id", name="plugins_plugin_id_unique"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    plugin_id: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    version: Mapped[str] = mapped_column(String, nullable=False)
    entrypoint: Mapped[str] = mapped_column(String, nullable=False)
    required_capabilities: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    optional_capabilities: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    permissions: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    registered_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())