"""D1 + Vectorize implementation of the memory routes' storage paths.

Mirrors ``yomi.app.routes.memory`` semantics (cleaning, topic-rule
supersession, version chains, best-effort embeddings) on ``D1Store``:

- multi-statement writes go in **one D1 batch** (one transaction), with the
  vector outbox op in the same batch as the record write
- vectors use ``recordId = memory entry id``, ``revision = "v1"``; supersede,
  forget, and hard-delete enqueue vector deletes so stale vectors never
  crowd recall's topK
- recall fuses Vectorize candidates + keyword LIKE + metadata ranking with
  reciprocal-rank fusion in Python (D1 has no pgvector/tsvector)

Embeddings stay provider-backed via ``embed_memory_text`` (injectable for tests).
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import utcnow_iso
from yomi.services.memory.common import (
    MAX_MEMORY_CHARS,
    UUID_PATTERN,
    _clamp_confidence,
    _clean,
    _escape_like,
    _forget_after_date,
    _from_api_body,
    _hash,
    relation_for_memory,
)
from yomi.services.memory.embeddings import embed_memory_text
from yomi.services.memory.search import memory_search_knobs

VECTOR_REVISION = "v1"
# D1 caps LIKE/GLOB patterns at 50 bytes; stay well under with room for %%s.
LIKE_BUDGET_BYTES = 40

EmbedFn = Callable[[str], Awaitable[list[float]]]

_ACTIVE_LATEST = "status = 'active' AND is_latest = 1"


def row_dict(row: dict[str, Any]) -> dict[str, Any]:
    """D1 memory_entries row -> the camelCase shape routes return."""
    return {
        "id": row.get("id"),
        "userId": row.get("user_id"),
        "customId": row.get("custom_id"),
        "contentHash": row.get("content_hash"),
        "kind": row.get("kind"),
        "scope": row.get("scope"),
        "topic": row.get("topic"),
        "summary": row.get("summary"),
        "content": row.get("content"),
        "contentTsv": None,
        "status": row.get("status"),
        "confidence": row.get("confidence"),
        "sourceType": row.get("source_type"),
        "sourcePath": row.get("source_path"),
        "version": row.get("version"),
        "isLatest": bool(row.get("is_latest")),
        "isStatic": bool(row.get("is_static")),
        "rootMemoryId": row.get("root_memory_id"),
        "parentMemoryId": row.get("parent_memory_id"),
        "forgetAfter": row.get("forget_after"),
        "metadata": _parse_json(row.get("metadata")),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def _parse_json(value: Any) -> Any:
    if value is None or isinstance(value, (dict, list)):
        return value
    if isinstance(value, str) and value:
        import json

        try:
            return json.loads(value)
        except ValueError:
            return None
    return None


def keyword_pattern(query: str) -> str:
    """Fit the query into D1's LIKE pattern budget without splitting UTF-8."""
    return " ".join(keyword_words(query))


def keyword_words(query: str) -> list[str]:
    """Query words that fit D1's LIKE pattern budget (bytes, not chars).

    Capped at 12 words: the search word-OR spans 6 columns, and D1 allows
    at most 100 bound parameters per statement.
    """
    words: list[str] = []
    used = 0
    for word in query.split():
        if len(words) >= 12:
            break
        cost = len(word.encode()) + 1
        if used + cost > LIKE_BUDGET_BYTES:
            break
        words.append(word)
        used += cost
    if not words:
        raw = query.encode()[:LIKE_BUDGET_BYTES].decode("utf-8", "ignore").strip()
        return [raw] if raw else []
    return words


def rrf_fuse(ranked: list[tuple[str, list[str]]], k: int) -> dict[str, dict[str, Any]]:
    """Reciprocal-rank fusion over (source, id-list) pairs. Ranks are 1-based."""
    scores: dict[str, float] = {}
    matched: dict[str, list[str]] = {}
    for source, ids in ranked:
        for rank, memory_id in enumerate(ids, start=1):
            scores[memory_id] = scores.get(memory_id, 0.0) + 1.0 / (k + rank)
            matched.setdefault(memory_id, []).append(source)
    return {mid: {"score": score, "matchedBy": matched[mid]} for mid, score in scores.items()}


def _vector_delete_op(user_id: str, memory_id: str, now: str) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "kind": "memory",
        "record_id": memory_id,
        "revision": VECTOR_REVISION,
        "operation": "delete",
        "payload": None,
        "attempts": 0,
        "last_error": None,
        "created_at": now,
        "processed_at": None,
    }


async def prune_expired(backend: D1Backend, user_id: str) -> None:
    await backend.store.atomic([
        Statement(
            "UPDATE memory_entries SET status = 'forgotten', updated_at = ? "
            "WHERE user_id = ? AND status = 'active' "
            "AND forget_after IS NOT NULL AND forget_after < ?",
            [utcnow_iso(), user_id, utcnow_iso()],
        )
    ])


async def list_entries(backend: D1Backend, user_id: str, limit: int) -> list[dict[str, Any]]:
    rows = await backend.store.fetch_all(
        f"SELECT * FROM memory_entries WHERE user_id = ? AND {_ACTIVE_LATEST} "
        "ORDER BY is_static DESC, updated_at DESC LIMIT ?",
        [user_id, limit],
    )
    return [row_dict(row) for row in rows]


async def list_superseded(backend: D1Backend, user_id: str, limit: int) -> list[dict[str, Any]]:
    rows = await backend.store.fetch_all(
        "SELECT * FROM memory_entries WHERE user_id = ? AND status = 'superseded' "
        "ORDER BY updated_at DESC LIMIT ?",
        [user_id, limit],
    )
    rows = list(rows)
    if not rows:
        return []
    ids = [row["id"] for row in rows]
    placeholders = ", ".join("?" for _ in ids)
    edges = await backend.store.fetch_all(
        "SELECT from_memory_id, to_memory_id FROM memory_relations "
        "WHERE user_id = ? AND relation_type = 'updates' "
        f"AND to_memory_id IN ({placeholders})",
        [user_id, *ids],
    )
    from_ids = list({edge["from_memory_id"] for edge in edges})
    replacements: dict[str, dict] = {}
    if from_ids:
        placeholders = ", ".join("?" for _ in from_ids)
        for row in await backend.store.fetch_all(
            f"SELECT * FROM memory_entries WHERE user_id = ? AND id IN ({placeholders})",
            [user_id, *from_ids],
        ):
            replacements[str(row["id"])] = row_dict(row)
    out = []
    for row in rows:
        item = row_dict(row)
        by_id = {str(edge["to_memory_id"]): edge["from_memory_id"] for edge in edges}
        replacement = replacements.get(str(by_id.get(str(row["id"]), "")))
        item["replacedBy"] = replacement
        out.append(item)
    return out


async def profile(backend: D1Backend, user_id: str, query: str, limit: int) -> dict[str, Any]:
    base = f"user_id = ? AND {_ACTIVE_LATEST}"
    static_rows = await backend.store.fetch_all(
        f"SELECT * FROM memory_entries WHERE {base} AND is_static = 1 "
        "ORDER BY confidence DESC, updated_at DESC LIMIT ?",
        [user_id, limit],
    )
    dynamic_rows = await backend.store.fetch_all(
        f"SELECT * FROM memory_entries WHERE {base} AND is_static = 0 "
        "ORDER BY confidence DESC, updated_at DESC LIMIT ?",
        [user_id, limit],
    )
    relevant: list[dict] = []
    if query:
        pattern = f"%{_escape_like(keyword_pattern(query))}%"
        relevant = await backend.store.fetch_all(
            f"SELECT * FROM memory_entries WHERE {base} AND ("
            "topic LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' "
            "OR summary LIKE ? ESCAPE '\\') "
            "ORDER BY is_static DESC, confidence DESC, updated_at DESC LIMIT ?",
            [user_id, pattern, pattern, pattern, min(limit, 12)],
        )
    return {
        "profile": {
            "static": [row["summary"] or row["content"] for row in static_rows],
            "dynamic": [row["summary"] or row["content"] for row in dynamic_rows],
        },
        "memories": [row_dict(row) for row in relevant],
    }


async def fetch_entry(backend: D1Backend, user_id: str, memory_id: str) -> dict | None:
    row = await _fetch_by_id(backend, user_id, memory_id)
    return row_dict(row) if row else None


async def _fetch_by_id(backend: D1Backend, user_id: str, memory_id: str) -> dict | None:
    return await backend.store.fetch_one(
        "SELECT * FROM memory_entries WHERE user_id = ? AND id = ? LIMIT 1",
        [user_id, memory_id],
    )


async def upsert(
    backend: D1Backend,
    user_id: str,
    input_data: dict[str, Any],
    embed: EmbedFn = embed_memory_text,
) -> dict[str, Any] | None:
    """Mirror of the Postgres ``upsert_memory``: same cleaning, topic-rule
    supersession, version chains, and best-effort embedding — one D1 batch."""
    input_data = _from_api_body(input_data)
    content = _clean(input_data.get("content"), MAX_MEMORY_CHARS)
    topic = _clean(
        input_data.get("topic") or input_data.get("summary") or content.split("\n")[0] or "memory",
        160,
    )
    if not content:
        return None

    custom_id = _clean(input_data.get("customId"), 200) if input_data.get("customId") else None
    content_hash = _hash(
        f"{input_data.get('kind') or 'fact'}\0{input_data.get('scope') or 'global'}\0"
        f"{topic}\0{content}"
    )

    existing: dict | None = None
    if input_data.get("id"):
        existing = await _fetch_by_id(backend, user_id, _clean(input_data["id"], 80))
    elif custom_id:
        existing = await backend.store.fetch_one(
            "SELECT * FROM memory_entries WHERE user_id = ? AND custom_id = ? "
            "AND is_latest = 1 LIMIT 1",
            [user_id, custom_id],
        )

    named_id = _clean(input_data.get("replacesId"), 80)
    replaces_id = named_id if UUID_PATTERN.match(named_id) else ""
    replaced: dict | None = None
    if replaces_id and replaces_id != str((existing or {}).get("id") or ""):
        replaced = await backend.store.fetch_one(
            f"SELECT * FROM memory_entries WHERE user_id = ? AND id = ? AND {_ACTIVE_LATEST} "
            "LIMIT 1",
            [user_id, replaces_id],
        )

    if input_data.get("modelJudged"):
        candidates: list[dict] = []
    else:
        pattern = f"%{_escape_like(topic)}%"
        candidates = await backend.store.fetch_all(
            f"SELECT * FROM memory_entries WHERE user_id = ? AND {_ACTIVE_LATEST} AND ("
            "topic LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\') "
            "ORDER BY confidence DESC, updated_at DESC LIMIT 8",
            [user_id, pattern, pattern],
        )

    existing_id = str((existing or {}).get("id") or "")
    replaced_id = str((replaced or {}).get("id") or "")
    superseded = [
        *( [existing] if existing is not None else []),
        *( [replaced] if replaced is not None else []),
        *[
            row
            for row in candidates
            if str(row["id"]) != existing_id
            and str(row["id"]) != replaced_id
            and relation_for_memory(input_data, {"topic": row.get("topic")}) == "updates"
        ],
    ]
    parent = superseded[0] if superseded else None

    now = utcnow_iso()
    summary = _clean(input_data.get("summary"), 500) if input_data.get("summary") else None
    forget_after = _forget_after_date(input_data.get("forgetAfter"))
    metadata = input_data.get("metadata")
    entry_id = str(uuid.uuid4())
    entry: dict[str, Any] = {
        "id": entry_id,
        "user_id": user_id,
        "custom_id": custom_id or (existing or {}).get("custom_id"),
        "content_hash": content_hash,
        "kind": _clean(input_data.get("kind") or "fact", 40) or "fact",
        "scope": _clean(input_data.get("scope") or "global", 80) or "global",
        "topic": topic,
        "summary": summary,
        "content": content,
        "status": "active",
        "confidence": _clamp_confidence(input_data.get("confidence")),
        "source_type": (
            _clean(input_data.get("sourceType"), 80) if input_data.get("sourceType") else None
        ),
        "source_path": (
            _clean(input_data.get("sourcePath"), 500) if input_data.get("sourcePath") else None
        ),
        "version": (int(parent.get("version") or 0) + 1) if parent else 1,
        "is_latest": 1,
        "is_static": 1 if input_data.get("isStatic") is True else 0,
        "root_memory_id": (
            parent.get("root_memory_id") or parent.get("id")
            if parent
            else None
        ),
        "parent_memory_id": parent.get("id") if parent else None,
        "forget_after": forget_after.isoformat() if forget_after else None,
        "metadata": metadata,
        "created_at": now,
        "updated_at": now,
    }

    statements: list[Statement] = []
    if existing and existing.get("custom_id"):
        statements.append(Statement(
            "UPDATE memory_entries SET custom_id = NULL WHERE id = ?",
            [existing["id"]],
        ))
    statements.append(backend.store.insert("memory_entries", entry))
    for row in superseded:
        statements.append(Statement(
            "UPDATE memory_entries SET status = 'superseded', is_latest = 0, updated_at = ? "
            "WHERE id = ?",
            [now, row["id"]],
        ))
        statements.append(backend.store.insert("memory_relations", {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "from_memory_id": entry_id,
            "to_memory_id": row["id"],
            "relation_type": "updates",
            "created_at": now,
        }))
    if input_data.get("sourcePath"):
        statements.append(backend.store.insert("memory_sources", {
            "id": str(uuid.uuid4()),
            "memory_id": entry_id,
            "document_id": None,
            "chunk_id": None,
            "source_path": _clean(input_data["sourcePath"], 500),
            "relevance": 100,
            "created_at": now,
        }))

    # Best-effort embedding: failure skips the vector, never the memory write.
    try:
        embedding = await embed(
            f"{entry['kind']}: {entry['topic']}\n{entry['summary'] or ''}\n{entry['content']}"
        )
    except Exception:
        embedding = []
    if embedding:
        statements.append(backend.store.insert("vector_sync_outbox", {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "kind": "memory",
            "record_id": entry_id,
            "revision": "v1",
            "operation": "upsert",
            "payload": {"values": [float(v) for v in embedding]},
            "attempts": 0,
            "last_error": None,
            "created_at": now,
            "processed_at": None,
        }))
    for row in superseded:
        statements.append(
            backend.store.insert(
                "vector_sync_outbox", _vector_delete_op(user_id, str(row["id"]), now)
            )
        )
    if len(statements) > 100:
        raise ValueError("Memory upsert exceeds the D1 batch statement limit")
    await backend.store.atomic(statements)
    return row_dict(entry)


async def search(
    backend: D1Backend,
    user_id: str,
    query: str,
    limit: int,
    max_chars: int,
    embed: EmbedFn = embed_memory_text,
) -> list[dict[str, Any]]:
    """Hybrid recall: Vectorize candidates + keyword LIKE + metadata ranking,
    fused with RRF — the D1 counterpart of ``build_recall_cte``."""
    knobs = memory_search_knobs()
    if not query:
        return await list_entries(backend, user_id, limit)

    try:
        query_embedding = await embed(query)
    except Exception:
        query_embedding = []

    vector_ids: list[str] = []
    if query_embedding:
        try:
            matches = await backend.client.vector_query(
                user_id, "memory", query_embedding, limit=knobs["candidates"]
            )
            vector_ids = [
                str(m["recordId"]) for m in matches
                if isinstance(m.get("recordId"), str)
            ]
        except Exception:
            vector_ids = []

    words = [w.lower() for w in keyword_words(query)]
    keyword_rows: list[dict] = []
    if words:
        columns = ("topic", "summary", "content", "kind", "scope", "source_path")
        like_or = " OR ".join(f"{col} LIKE ? ESCAPE '\\'" for col in columns for _ in words)
        word_params: list[Any] = []
        for _ in columns:
            for word in words:
                word_params.append(f"%{_escape_like(word)}%")
        for row in await backend.store.fetch_all(
            f"SELECT id, topic, summary, content, kind, scope, source_path "
            f"FROM memory_entries WHERE user_id = ? AND {_ACTIVE_LATEST} "
            f"AND ({like_or}) LIMIT ?",
            [user_id, *word_params, knobs["candidates"]],
        ):
            haystack = " ".join(str(row.get(col) or "") for col in columns).lower()
            hits = sum(1 for word in words if word in haystack)
            keyword_rows.append({"id": row["id"], "hits": hits})
        keyword_rows.sort(key=lambda r: r["hits"], reverse=True)
    meta_rows = await backend.store.fetch_all(
        f"SELECT id FROM memory_entries WHERE user_id = ? AND {_ACTIVE_LATEST} AND ("
        "topic = ? COLLATE NOCASE OR summary = ? COLLATE NOCASE "
        "OR content = ? COLLATE NOCASE OR kind = ? COLLATE NOCASE "
        "OR scope = ? COLLATE NOCASE OR source_path = ? COLLATE NOCASE) "
        "ORDER BY is_static DESC, confidence DESC, updated_at DESC LIMIT ?",
        [user_id, query, query, query, query, query, query, knobs["candidates"]],
    )
    fused = rrf_fuse(
        [
            ("vector", vector_ids),
            ("full_text", [str(r["id"]) for r in keyword_rows]),
            ("metadata", [str(r["id"]) for r in meta_rows]),
        ],
        knobs["rrf_k"],
    )
    top = sorted(fused, key=lambda mid: fused[mid]["score"], reverse=True)[:limit]
    if not top:
        return []
    placeholders = ", ".join("?" for _ in top)
    rows = await backend.store.fetch_all(
        f"SELECT * FROM memory_entries WHERE user_id = ? AND id IN ({placeholders})",
        [user_id, *top],
    )
    by_id = {str(row["id"]): row for row in rows}
    ordered = [by_id[mid] for mid in top if mid in by_id]
    ordered.sort(
        key=lambda r: (
            int(r.get("is_static") or 0),
            fused[str(r["id"])]["score"],
            int(r.get("confidence") or 0),
            str(r.get("updated_at") or ""),
        ),
        reverse=True,
    )

    memories: list[dict[str, Any]] = []
    used = 0
    for row in ordered:
        item = row_dict(row)
        item["score"] = fused[str(row["id"])]["score"]
        item["matchedBy"] = fused[str(row["id"])]["matchedBy"]
        summary = item.get("summary") or ""
        serialized = (
            f"{item.get('kind') or ''}: {item.get('topic') or ''}\n"
            + (f"{summary}\n" if summary else "")
            + str(item.get("content") or "")
        )
        if used + len(serialized) > max_chars:
            break
        memories.append(item)
        used += len(serialized)
    return memories


async def forget(
    backend: D1Backend,
    user_id: str,
    item_id: str = "",
    custom_id: str = "",
    query: str = "",
    hard: bool = False,
) -> dict[str, Any]:
    now = utcnow_iso()
    if item_id:
        where = "user_id = ? AND id = ?"
        params: list[Any] = [user_id, item_id]
    elif custom_id:
        where = "user_id = ? AND custom_id = ?"
        params = [user_id, custom_id]
    else:
        pattern = f"%{_escape_like(keyword_pattern(query))}%"
        where = (
            f"user_id = ? AND {_ACTIVE_LATEST} AND ("
            "topic LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')"
        )
        params = [user_id, pattern, pattern]

    if hard:
        stmt = Statement(
            f"DELETE FROM memory_entries WHERE {where} RETURNING id", params
        )
    else:
        stmt = Statement(
            f"UPDATE memory_entries SET status = 'forgotten', updated_at = ? WHERE {where} "
            "RETURNING id",
            [now, *params],
        )
    results = await backend.store.atomic([stmt])
    ids = [str(r["id"]) for r in (results[0].get("results") or []) if r.get("id")]
    if ids:
        await backend.store.atomic([
            backend.store.insert(
                "vector_sync_outbox", _vector_delete_op(user_id, memory_id, now)
            )
            for memory_id in ids
        ])
    key = "deleted" if hard else "forgotten"
    return {key: len(ids), "ids": ids}


async def sync_remove(
    backend: D1Backend, user_id: str, ids: list[str], custom_ids: list[str]
) -> int:
    removed = 0
    for item_id in ids:
        res = await forget(backend, user_id, item_id=item_id)
        removed += int(res.get("forgotten", 0))
    for custom_item_id in custom_ids:
        res = await forget(backend, user_id, custom_id=custom_item_id)
        removed += int(res.get("forgotten", 0))
    return removed


async def graph_walk(
    backend: D1Backend, user_id: str, root_id: str, max_depth: int, max_nodes: int
) -> dict[str, Any]:
    visited: set[str] = set()
    chain: list[dict] = []
    branched: list[dict] = []

    async def walk(node_id: str, depth: int) -> None:
        if node_id in visited or depth > max_depth or len(visited) >= max_nodes:
            return
        visited.add(node_id)
        relations = await backend.store.fetch_all(
            "SELECT to_memory_id, relation_type FROM memory_relations "
            "WHERE user_id = ? AND from_memory_id = ? LIMIT 10",
            [user_id, node_id],
        )
        entry = await _fetch_by_id(backend, user_id, node_id)
        if entry is None:
            return
        node = {
            "id": entry["id"],
            "kind": entry["kind"],
            "scope": entry["scope"],
            "topic": entry["topic"],
            "status": entry["status"],
            "content": entry["content"],
            "confidence": entry["confidence"],
            "isStatic": bool(entry["is_static"]),
            "updatedAt": entry["updated_at"],
            "relations": [
                {"targetId": r["to_memory_id"], "relationType": r["relation_type"]}
                for r in relations
            ],
        }
        (chain if depth == 0 else branched).append(node)
        for rel in relations:
            await walk(str(rel["to_memory_id"]), depth + 1)

    await walk(root_id, 0)
    return {"root": chain[0] if chain else None, "chain": chain, "branched": branched}
