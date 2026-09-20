"""Memory consolidation sweep — merges duplicate memory rows.

Port of apps/backend/src/services/memory/consolidation.ts. Detects near-duplicate
embeddings per user, retires the older row as status='merged', and records a
`merges` relation edge from the survivor. Self-limiting: once a row flips to
'merged' it fails the active/latest join, so a pair can never be rematched (
design doc, "Self-limiting, no new column").
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any, TypedDict

from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.db.models_app import MemoryEntry, MemoryRelation

# Deliberately much stricter than TURN_CANDIDATE_LIMIT's unbounded shortlist
# (contradiction.py) — there is no LLM double-check here to catch an
# elaboration being wrongly merged, so detection must be conservative.
DEFAULT_MAX_DISTANCE = 0.03
MAX_DISTANCE_CEILING = 0.25


class DuplicatePair(TypedDict):
    userId: str
    aId: str
    aCreatedAt: datetime
    bId: str
    bCreatedAt: datetime


class Survivor(TypedDict):
    survivor_id: str
    retired_id: str


def max_distance() -> float:
    raw_value = os.environ.get("MEMORY_CONSOLIDATION_MAX_DISTANCE")
    try:
        raw = float(raw_value) if raw_value is not None else 0.0
    except ValueError:
        raw = 0.0
    if raw <= 0:
        return DEFAULT_MAX_DISTANCE
    return min(raw, MAX_DISTANCE_CEILING)


def _as_datetime(value: Any, default: datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return default
    return default


def _pair_from_row(row: dict[str, Any]) -> DuplicatePair | None:
    user_id = row.get("userId")
    a_id = row.get("aId")
    b_id = row.get("bId")
    if not isinstance(user_id, str) or a_id is None or b_id is None:
        return None
    return {
        "userId": user_id,
        "aId": str(a_id),
        "aCreatedAt": _as_datetime(row.get("aCreatedAt"), datetime.min),
        "bId": str(b_id),
        "bCreatedAt": _as_datetime(row.get("bCreatedAt"), datetime.min),
    }


# Self-joins memory_embeddings per user (memory_id > memory_id guards against
# matching a pair twice), requiring both sides active/latest and sharing a kind.
async def find_duplicate_pairs(
    session: AsyncSession, batch_size: int
) -> list[DuplicatePair]:
    distance = max_distance()
    try:
        result = await session.execute(
            text(
                """
                select a.user_id as "userId",
                       a.id as "aId", a.created_at as "aCreatedAt",
                       b.id as "bId", b.created_at as "bCreatedAt"
                from memory_embeddings ea
                join memory_embeddings eb
                  on eb.user_id = ea.user_id and eb.memory_id > ea.memory_id
                join memory_entries a on a.id = ea.memory_id
                  and a.status = 'active' and a.is_latest = true
                join memory_entries b on b.id = eb.memory_id
                  and b.status = 'active' and b.is_latest = true
                  and b.kind = a.kind
                where ea.embedding <=> eb.embedding < :distance
                order by (ea.embedding <=> eb.embedding) asc
                limit :batch_size
                """
            ),
            {"distance": distance, "batch_size": batch_size},
        )
    except Exception:
        return []
    rows = [dict(row) for row in result.mappings()]
    return [pair for pair in (_pair_from_row(row) for row in rows) if pair is not None]


# The row with the later createdAt survives; ties break on id for determinism.
def pick_survivor(pair: DuplicatePair) -> Survivor:
    a_wins = pair["aCreatedAt"] > pair["bCreatedAt"] or (
        pair["aCreatedAt"] == pair["bCreatedAt"] and pair["aId"] > pair["bId"]
    )
    if a_wins:
        return {"survivor_id": pair["aId"], "retired_id": pair["bId"]}
    return {"survivor_id": pair["bId"], "retired_id": pair["aId"]}


# The retired row's status flip and the `merges` relation edge must land
# together. status='merged', never 'superseded' — a duplicate must never
# supersede (CONTEXT.md). No version/parent change: a duplicate is not a content
# evolution of the survivor.
async def merge_pair(session: AsyncSession, pair: DuplicatePair) -> None:
    picked = pick_survivor(pair)
    survivor_id, retired_id = picked["survivor_id"], picked["retired_id"]
    await session.execute(
        update(MemoryEntry)
        .where(MemoryEntry.id == retired_id, MemoryEntry.status == "active")
        .values(
            status="merged",
            is_latest=False,
            custom_id=None,
            updated_at=datetime.now(UTC),
        )
    )
    session.add(
        MemoryRelation(
            user_id=pair["userId"],
            from_memory_id=survivor_id,
            to_memory_id=retired_id,
            relation_type="merges",
        )
    )


# Best-effort per pair: one failure (e.g. a row deleted concurrently) doesn't
# abort the batch — matches every other sweep in runCronSweeps (TS index.ts).
async def sweep_memory_consolidation(
    session: AsyncSession, batch_size: int = 25
) -> int:
    pairs = await find_duplicate_pairs(session, batch_size)
    merged = 0
    for pair in pairs:
        try:
            await merge_pair(session, pair)
            merged += 1
        except Exception:
            continue  # best-effort — keep going with the remaining pairs
    return merged