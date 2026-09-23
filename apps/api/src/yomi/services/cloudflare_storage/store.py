"""D1 row encoding and transactional store primitives.

D1 has no native UUID, JSON, or timestamptz types. All such values are
serialized by the caller side:

- UUID / datetime / date -> ISO/text strings (UTC, ``+00:00`` suffix kept)
- bool -> 0 / 1 (also enforced by ``Statement.payload``)
- dict / list -> compact JSON text
- None stays NULL

Every multi-statement write that must be atomic goes through one ``batch``
call, which D1 executes as a single transaction. ``D1Store`` never retries:
a transport failure leaves the outcome unknown, and the caller must reconcile
(credit paths do this via idempotency keys).
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime
from typing import Any

from yomi.services.cloudflare_storage.client import Scalar, Statement, StorageClient


def utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def encode(value: Any) -> Scalar:
    if value is None or isinstance(value, (str, int, float)):
        return value
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (dict, list)):
        return json.dumps(value, separators=(",", ":"), sort_keys=True)
    raise TypeError(f"Cannot encode {type(value).__name__} for D1")


def encode_row(row: dict[str, Any]) -> dict[str, Scalar]:
    return {key: encode(value) for key, value in row.items()}


def parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    return None


class D1Store:
    """Thin transactional wrapper over the storage gateway's D1 endpoints."""

    def __init__(self, client: StorageClient):
        self.client = client

    async def fetch_all(self, sql: str, params: list[Any] | None = None) -> list[dict]:
        return await self.client.query(sql, _params(params))

    async def fetch_one(self, sql: str, params: list[Any] | None = None) -> dict | None:
        rows = await self.fetch_all(sql, params)
        return rows[0] if rows else None

    async def atomic(self, statements: list[Statement]) -> list[dict]:
        """Run 1-100 statements as a single D1 transaction. No implicit retry."""
        return await self.client.batch(statements)

    def insert(self, table: str, row: dict[str, Any]) -> Statement:
        encoded = encode_row(row)
        columns = ", ".join(f'"{key}"' for key in encoded)
        placeholders = ", ".join("?" for _ in encoded)
        return Statement(
            f'INSERT INTO "{table}" ({columns}) VALUES ({placeholders})',
            list(encoded.values()),
        )

    def insert_or_ignore(self, table: str, row: dict[str, Any]) -> Statement:
        stmt = self.insert(table, row)
        return Statement(stmt.sql.replace("INSERT INTO", "INSERT OR IGNORE INTO", 1), stmt.params)

    def insert_or_replace(self, table: str, row: dict[str, Any]) -> Statement:
        stmt = self.insert(table, row)
        return Statement(stmt.sql.replace("INSERT INTO", "INSERT OR REPLACE INTO", 1), stmt.params)


def _params(params: list[Any] | None) -> list[Scalar]:
    if not params:
        return []
    ordered: list[Scalar] = []
    for value in params:
        encoded = encode(value)
        if isinstance(encoded, bool):
            encoded = int(encoded)
        ordered.append(encoded)
    return ordered
