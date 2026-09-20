"""stamp baseline — schema owned by drizzle migrations 0000-0042

The full Yomi schema already exists in the live Neon database, created by the
rollup migration in the TS toolchain (packages/db/drizzle/**). To avoid a
duplicate schema-owner, this revision is a no-op that only records "baseline"
so `alembic stamp 0001_baseline` / `alembic upgrade head` is a safe no-op on
existing DBs and gives future Alembic migrations a clean parent.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-09-20

"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "0001_baseline"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # no-op: schema is created and versioned by the drizzle migration toolchain.
    pass


def downgrade() -> None:
    pass