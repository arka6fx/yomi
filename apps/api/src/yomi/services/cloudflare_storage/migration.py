"""Neon -> D1 migration transforms (pure, DB-free).

Export writes one JSONL file per table with values normalized by
``export_value``. Import reads those files and produces D1 statements:

- data tables -> ``INSERT OR REPLACE`` (idempotent re-runs)
- ``memory_embeddings`` / ``rag_embeddings`` -> vector outbox upserts,
  keyed ``revision = "neon:<embedding-row-id>"`` so re-imports are ignored
  by the outbox unique constraint instead of duplicating Vectorize writes
- Postgres-only generated columns (``*_tsv``) are dropped; D1 has no
  tsvector and search moves to keyword + Vectorize ranking

Verify compares manifest checksums (sha256 over ordered primary-key
strings) against D1, so it detects missing or extra rows without pulling
whole tables back.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

VECTOR_TABLES = {"memory_embeddings": "memory", "rag_embeddings": "rag"}
SKIP_TABLES = set(VECTOR_TABLES) | {"vector_sync_outbox", "d1_migrations", "alembic_version"}
GENERATED_COLUMNS = {"content_tsv", "summary_tsv"}
MIGRATION_REVISION_PREFIX = "neon:"
D1_BATCH_SIZE = 50


def export_value(value: Any) -> Any:
    if value is None or isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("[") and text.endswith("]") and len(text) > 2:
            try:
                return [float(part) for part in text[1:-1].split(",") if part.strip()]
            except ValueError:
                return value
        return value
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        text = value.isoformat()
        return text if value.tzinfo else text + "+00:00"
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).hex()
    if isinstance(value, (list, tuple)):
        return [export_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): export_value(item) for key, item in value.items()}
    return str(value)


def export_row(mapping: dict[str, Any]) -> dict[str, Any]:
    return {key: export_value(value) for key, value in mapping.items()}


def checksum_ids(ids: list[Any]) -> str:
    digest = hashlib.sha256()
    for raw in sorted(str(item) for item in ids):
        digest.update(raw.encode())
        digest.update(b"\x00")
    return digest.hexdigest()


def manifest_entry(table: str, rows: list[dict[str, Any]], pk: str = "id") -> dict[str, Any]:
    ids = [row.get(pk, "") for row in rows]
    return {
        "table": table,
        "count": len(rows),
        "id_checksum": checksum_ids(ids),
        "pk": pk,
    }


def transform_row(table: str, row: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Classify an exported row: ('data', cleaned) or ('vector', outbox-op)."""
    if table in VECTOR_TABLES:
        kind = VECTOR_TABLES[table]
        record_key = "memory_id" if kind == "memory" else "chunk_id"
        values = row.get("embedding") or []
        if not isinstance(values, list) or not values:
            raise ValueError(f"Embedding row {row.get('id')} has no vector")
        return ("vector", {
            "user_id": row.get("user_id", ""),
            "kind": kind,
            "record_id": str(row.get(record_key, "")),
            "revision": f"{MIGRATION_REVISION_PREFIX}{row.get('id', '')}",
            "operation": "upsert",
            "payload": {"values": [float(v) for v in values]},
        })
    cleaned = {key: value for key, value in row.items() if key not in GENERATED_COLUMNS}
    return ("data", cleaned)


def encode_json_line(row: dict[str, Any]) -> str:
    return json.dumps(row, separators=(",", ":"), sort_keys=True)
