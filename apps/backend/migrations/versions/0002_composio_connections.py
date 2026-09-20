"""composio_connections — per-user Composio connection snapshot.

Local mirror of a user's Composio connections (one entity per toolkit). Kept
in sync from Composio webhook events and by a refresh on tool build; lets the
dashboard show status/connectivity without a remote round-trip and gives
webhook handlers a durable row to update.

Revision ID: 0002_composio_connections
Revises: 0001_baseline
Create Date: 2026-09-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_composio_connections"
down_revision: str | None = "0001_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "composio_connections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("entity_id", sa.String(), nullable=False),
        sa.Column("toolkit", sa.String(), nullable=False),
        sa.Column("connected_account_id", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="INACTIVE"),
        sa.Column("status_reason", sa.String(), nullable=True),
        sa.Column("alias", sa.String(), nullable=True),
        sa.Column("connected_at", sa.DateTime(), nullable=True),
        sa.Column("last_trigger_event_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("user_id", "toolkit", name="composio_connections_user_toolkit_unique"),
    )
    op.create_index("composio_connections_user_idx", "composio_connections", ["user_id"])
    op.create_index(
        "composio_connections_account_idx",
        "composio_connections",
        ["connected_account_id"],
    )
    op.create_index("composio_connections_status_idx", "composio_connections", ["status"])


def downgrade() -> None:
    op.drop_index("composio_connections_status_idx", table_name="composio_connections")
    op.drop_index("composio_connections_account_idx", table_name="composio_connections")
    op.drop_index("composio_connections_user_idx", table_name="composio_connections")
    op.drop_table("composio_connections")