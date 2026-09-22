"""Durable Vectorize sync via a D1 outbox.

D1 is the source of truth; Vectorize is a derived index. Every record write
that needs a vector enqueues an outbox row **in the same D1 batch** as the
record write, so a committed record always has a pending sync entry. A sweeper
claims entries, applies the Vectorize mutation, and marks them processed.

Vectorize mutations are asynchronous and eventually consistent: a just-written
vector may not appear in queries for seconds. Recall paths must treat vector
results as best-effort and fall back to keyword/metadata ranking.

Claiming bumps ``attempts`` and stamps ``claimed_at`` in the same atomic batch
as the select, so two sweepers rarely process the same entry; if they do,
upserts are idempotent (same id + values) and deletes are idempotent.
Entries that fail repeatedly stay visible with ``last_error`` for inspection.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Literal

from yomi.services.cloudflare_storage.client import (
    RecordType,
    Statement,
    StorageClient,
    StorageError,
)
from yomi.services.cloudflare_storage.store import D1Store, new_id, utcnow_iso

logger = logging.getLogger(__name__)

Operation = Literal["upsert", "delete"]
VECTOR_DIMS = 1536
MAX_ATTEMPTS = 25


def enqueue_ops(store: D1Store, ops: list[dict[str, Any]]) -> list[Statement]:
    """Build outbox INSERT statements to append to the record write's batch."""
    statements: list[Statement] = []
    for op in ops:
        kind: RecordType = op["kind"]
        operation: Operation = op["operation"]
        if kind not in ("memory", "rag") or operation not in ("upsert", "delete"):
            raise ValueError("Invalid vector outbox operation")
        payload = op.get("payload")
        if operation == "upsert":
            values = (payload or {}).get("values")
            if (
                not isinstance(values, list)
                or len(values) != VECTOR_DIMS
                or not all(isinstance(v, (int, float)) for v in values)
            ):
                raise ValueError(f"Upsert payload must carry {VECTOR_DIMS} numeric values")
        statements.append(
            store.insert("vector_sync_outbox", {
                "id": new_id(),
                "user_id": op["user_id"],
                "kind": kind,
                "record_id": op["record_id"],
                "revision": op["revision"],
                "operation": operation,
                "payload": payload,
                "attempts": 0,
                "last_error": None,
                "created_at": utcnow_iso(),
                "processed_at": None,
            })
        )
    return statements


async def claim_pending(store: D1Store, limit: int = 50) -> list[dict[str, Any]]:
    """Atomically select pending entries and bump their attempt counters."""
    if not 1 <= limit <= 100:
        raise ValueError("Claim limit must be 1-100")
    results = await store.atomic([
        Statement(
            "UPDATE vector_sync_outbox SET attempts = attempts + 1 "
            "WHERE id IN (SELECT id FROM vector_sync_outbox "
            "WHERE processed_at IS NULL AND attempts < ? "
            "ORDER BY created_at ASC LIMIT ?)",
            [MAX_ATTEMPTS, limit],
        ),
        Statement(
            "SELECT id, user_id, kind, record_id, revision, operation, payload, attempts "
            "FROM vector_sync_outbox WHERE processed_at IS NULL AND attempts <= ? "
            "ORDER BY created_at ASC LIMIT ?",
            [MAX_ATTEMPTS, limit],
        ),
    ])
    return list(results[1].get("results") or [])


async def process_claimed(store: D1Store, client: StorageClient, entry: dict[str, Any]) -> None:
    entry_id = str(entry["id"])
    try:
        if entry["operation"] == "upsert":
            payload = json.loads(entry["payload"]) if isinstance(entry.get("payload"), str) else {}
            values = payload.get("values", []) if isinstance(payload, dict) else []
            await client.post("/vectors/upsert", {
                "userId": entry["user_id"],
                "kind": entry["kind"],
                "records": [{
                    "recordId": entry["record_id"],
                    "revision": entry["revision"],
                    "values": values,
                }],
            })
        else:
            await client.post("/vectors/delete", {
                "userId": entry["user_id"],
                "kind": entry["kind"],
                "records": [{
                    "recordId": entry["record_id"],
                    "revision": entry["revision"],
                }],
            })
    except StorageError as exc:
        await store.atomic([
            Statement(
                "UPDATE vector_sync_outbox SET last_error = ? WHERE id = ?",
                [f"{type(exc).__name__}: {exc}", entry_id],
            )
        ])
        logger.warning("vector sync failed for outbox entry %s", entry_id)
        return
    await store.atomic([
        Statement(
            "UPDATE vector_sync_outbox SET processed_at = ? WHERE id = ?",
            [utcnow_iso(), entry_id],
        )
    ])


async def sweep_once(
    store: D1Store, client: StorageClient, limit: int = 50
) -> dict[str, int]:
    claimed = await claim_pending(store, limit)
    processed = 0
    for entry in claimed:
        await process_claimed(store, client, entry)
        processed += 1
    return {"claimed": len(claimed), "processed": processed}
