"""Durable agent-run ledger on D1.

Lifecycle: queued → running → completed | failed. Claiming is a single
atomic UPDATE (no select-then-write race); Telegram redeliveries collapse
onto one row via the ``update_id`` unique key (INSERT OR IGNORE + compare).

Leases bound execution: a crashed executor's runs become claimable again
once ``lease_expires_at`` passes. Attempt counts cap retries.
"""

from __future__ import annotations

import uuid
from typing import Any

from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import utcnow_iso

LEASE_SECONDS = 300
MAX_OUTPUT_CHARS = 2_000
MAX_STEPS_PER_RUN = 50


def _now_plus(seconds: int) -> str:
    from datetime import UTC, datetime, timedelta

    return (datetime.now(UTC) + timedelta(seconds=seconds)).isoformat()


async def create_run(
    backend: D1Backend,
    *,
    user_id: str,
    platform: str = "telegram",
    chat_id: str,
    message_id: int | None = None,
    update_id: str | None = None,
    kind: str = "chat",
    input_text: str | None = None,
    duration_seconds: int | None = None,
    plan: str | None = None,
    max_attempts: int = 3,
) -> tuple[dict[str, Any], bool]:
    """Insert a run, or return the existing one for a redelivered update.

    Returns (run, created). Race-safe: INSERT OR IGNORE never fails, and the
    loser's follow-up SELECT finds the winner's row.
    """
    run_id = str(uuid.uuid4())
    now = utcnow_iso()
    await backend.store.atomic([
        backend.store.insert_or_ignore("agent_runs", {
            "id": run_id,
            "user_id": user_id,
            "platform": platform,
            "chat_id": chat_id,
            "message_id": message_id,
            "update_id": update_id,
            "kind": kind,
            "input_text": input_text[:8000] if input_text else None,
            "duration_seconds": duration_seconds,
            "plan": plan,
            "status": "queued",
            "lease_owner": None,
            "lease_expires_at": None,
            "attempts": 0,
            "max_attempts": max_attempts,
            "result_summary": None,
            "error": None,
            "created_at": now,
            "updated_at": now,
            "completed_at": None,
        })
    ])
    if update_id is not None:
        row = await backend.store.fetch_one(
            "SELECT * FROM agent_runs WHERE update_id = ? LIMIT 1", [update_id]
        )
    else:
        row = await backend.store.fetch_one(
            "SELECT * FROM agent_runs WHERE id = ? LIMIT 1", [run_id]
        )
    assert row is not None
    return row, str(row["id"]) == run_id


async def claim_due_runs(
    backend: D1Backend, owner: str, lease_seconds: int = LEASE_SECONDS, limit: int = 10
) -> list[dict[str, Any]]:
    """Atomically claim queued or lease-expired runs. Returns claimed rows."""
    if not 1 <= limit <= 50:
        raise ValueError("Claim limit must be 1-50")
    now = utcnow_iso()
    results = await backend.store.atomic([
        Statement(
            "UPDATE agent_runs SET status = 'running', lease_owner = ?, "
            "lease_expires_at = ?, attempts = attempts + 1, updated_at = ? "
            "WHERE id IN (SELECT id FROM agent_runs "
            "WHERE (status = 'queued' OR (status = 'running' AND lease_expires_at < ?)) "
            "AND attempts < max_attempts ORDER BY created_at ASC LIMIT ?) "
            "RETURNING *",
            [owner, _now_plus(lease_seconds), now, now, limit],
        )
    ])
    return list(results[0].get("results") or [])


async def claim_run(backend: D1Backend, run_id: str, owner: str) -> dict | None:
    """Claim one known run if still queued. Returns the row, else None."""
    now = utcnow_iso()
    results = await backend.store.atomic([
        Statement(
            "UPDATE agent_runs SET status = 'running', lease_owner = ?, "
            "lease_expires_at = ?, attempts = attempts + 1, updated_at = ? "
            "WHERE id = ? AND status = 'queued' RETURNING *",
            [owner, _now_plus(LEASE_SECONDS), now, run_id],
        )
    ])
    rows = list(results[0].get("results") or [])
    return rows[0] if rows else None


async def heartbeat(
    backend: D1Backend, run_id: str, lease_seconds: int = LEASE_SECONDS
) -> None:
    await backend.store.atomic([
        Statement(
            "UPDATE agent_runs SET lease_expires_at = ?, updated_at = ? "
            "WHERE id = ? AND status = 'running'",
            [_now_plus(lease_seconds), utcnow_iso(), run_id],
        )
    ])


async def record_step(
    backend: D1Backend,
    run_id: str,
    step_index: int,
    tool_name: str | None,
    status: str = "done",
    input_text: str | None = None,
    output_text: str | None = None,
) -> None:
    if step_index >= MAX_STEPS_PER_RUN:
        return
    await backend.store.atomic([
        backend.store.insert("agent_run_steps", {
            "id": str(uuid.uuid4()),
            "run_id": run_id,
            "step_index": step_index,
            "tool_name": tool_name,
            "status": status,
            "input": input_text[:MAX_OUTPUT_CHARS] if input_text else None,
            "output": output_text[:MAX_OUTPUT_CHARS] if output_text else None,
            "created_at": utcnow_iso(),
        })
    ])


async def complete_run(backend: D1Backend, run_id: str, summary: str | None = None) -> None:
    now = utcnow_iso()
    await backend.store.atomic([
        Statement(
            "UPDATE agent_runs SET status = 'completed', result_summary = ?, "
            "lease_owner = NULL, lease_expires_at = NULL, updated_at = ?, "
            "completed_at = ? WHERE id = ?",
            [summary[:2000] if summary else None, now, now, run_id],
        )
    ])


async def fail_run(backend: D1Backend, run_id: str, error: str) -> str:
    """Mark failure; terminal when attempts are exhausted, else requeue.

    Returns the resulting status ('failed' or 'queued').
    """
    row = await backend.store.fetch_one(
        "SELECT attempts, max_attempts FROM agent_runs WHERE id = ? LIMIT 1", [run_id]
    )
    now = utcnow_iso()
    if row is None or int(row["attempts"]) >= int(row["max_attempts"]):
        await backend.store.atomic([
            Statement(
                "UPDATE agent_runs SET status = 'failed', error = ?, "
                "lease_owner = NULL, lease_expires_at = NULL, updated_at = ?, "
                "completed_at = ? WHERE id = ?",
                [error[:2000], now, now, run_id],
            )
        ])
        return "failed"
    await backend.store.atomic([
        Statement(
            "UPDATE agent_runs SET status = 'queued', error = ?, "
            "lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?",
            [error[:2000], now, run_id],
        )
    ])
    return "queued"


async def get_run(backend: D1Backend, run_id: str) -> dict | None:
    return await backend.store.fetch_one(
        "SELECT * FROM agent_runs WHERE id = ? LIMIT 1", [run_id]
    )


async def list_runs(backend: D1Backend, user_id: str, limit: int = 20) -> list[dict]:
    return await backend.store.fetch_all(
        "SELECT * FROM agent_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
        [user_id, max(1, min(limit, 100))],
    )


async def get_run_steps(backend: D1Backend, run_id: str) -> list[dict]:
    return await backend.store.fetch_all(
        "SELECT * FROM agent_run_steps WHERE run_id = ? ORDER BY step_index ASC LIMIT ?",
        [run_id, MAX_STEPS_PER_RUN],
    )
