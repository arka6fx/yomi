"""Better Auth-owned tables (apps/api/src/auth-schema.ts). Text PKs."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class User(Base):
    __tablename__ = "user"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    image: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'user'"))
    plan: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'explore'"))
    subscription_status: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'inactive'")
    )
    trial_start_date: Mapped[datetime | None] = mapped_column(DateTime)
    trial_end_date: Mapped[datetime | None] = mapped_column(DateTime)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime)
    dodo_customer_id: Mapped[str | None] = mapped_column(String)
    dodo_subscription_id: Mapped[str | None] = mapped_column(String)
    trial_interaction_used: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    trial_interaction_limit: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("100")
    )
    daily_chat_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    daily_voice_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    daily_image_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    agent_usage_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    daily_reset_date: Mapped[str | None] = mapped_column(String)
    agent_soul: Mapped[str | None] = mapped_column(String)
    soul_onboarding: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'unprompted'"))
    pending_connector_nudge: Mapped[dict | None] = mapped_column(JSONB)
    referral_code: Mapped[str | None] = mapped_column(String, unique=True)
    current_streak: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    longest_streak: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    last_active_date: Mapped[str | None] = mapped_column(String)
    total_messages_sent: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    leaderboard_opt_in: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    leaderboard_handle: Mapped[str | None] = mapped_column(String, unique=True)
    leaderboard_show_photo: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime)
    privacy_preferences: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    consent_version: Mapped[str | None] = mapped_column(String)
    consent_timestamp: Mapped[datetime | None] = mapped_column(DateTime)
    privacy_policy_version: Mapped[str | None] = mapped_column(String)
    terms_version: Mapped[str | None] = mapped_column(String)
    last_export_at: Mapped[datetime | None] = mapped_column(DateTime)
    export_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))


class Session(Base):
    __tablename__ = "session"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    token: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String)
    user_agent: Mapped[str | None] = mapped_column(String)
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)


class Account(Base):
    __tablename__ = "account"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    account_id: Mapped[str] = mapped_column(String, nullable=False)
    provider_id: Mapped[str] = mapped_column(String, nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    access_token: Mapped[str | None] = mapped_column(String)
    refresh_token: Mapped[str | None] = mapped_column(String)
    id_token: Mapped[str | None] = mapped_column(String)
    access_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    refresh_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    scope: Mapped[str | None] = mapped_column(String)
    password: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class Verification(Base):
    __tablename__ = "verification"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    identifier: Mapped[str] = mapped_column(String, nullable=False)
    value: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime)


class Organization(Base):
    __tablename__ = "organization"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str | None] = mapped_column(String, unique=True)
    logo: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    metadata_: Mapped[str | None] = mapped_column("metadata", String)


class Member(Base):
    __tablename__ = "member"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class Invitation(Base):
    __tablename__ = "invitation"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str | None] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    inviter_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False)