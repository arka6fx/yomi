"""A D1Store backed by in-memory SQLite running the real ``migrations-d1``.

D1 is SQLite, so tests exercise the actual schema and SQL instead of
pattern-matching statements.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import D1Store, _params

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations-d1"


class SqliteStore(D1Store):
    def __init__(self, users: tuple[str, ...] = ()) -> None:
        self.db = sqlite3.connect(":memory:", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        for path in sorted(MIGRATIONS.glob("*.sql")):
            self.db.executescript(path.read_text(encoding="utf-8"))
        for user_id in users:
            self.db.execute(
                'INSERT INTO "user" (id, name, email, created_at, updated_at) '
                "VALUES (?, ?, ?, 'now', 'now')",
                [user_id, user_id.title(), f"{user_id}@example.com"],
            )

    async def fetch_all(self, sql: str, params: list[Any] | None = None) -> list[dict]:
        return [dict(r) for r in self.db.execute(sql, _params(params)).fetchall()]

    async def atomic(self, statements: list[Statement]) -> list[dict]:
        out = []
        with self.db:
            for stmt in statements:
                rows = self.db.execute(stmt.sql, stmt.payload()["params"]).fetchall()
                out.append({"success": True, "results": [dict(r) for r in rows]})
        return out


def sqlite_backend(*users: str) -> D1Backend:
    return D1Backend(store=SqliteStore(users), client=None)  # type: ignore[arg-type]
