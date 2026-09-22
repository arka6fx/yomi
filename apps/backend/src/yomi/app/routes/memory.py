"""/api/memory — canonical memory CRUD, recall, and graph traversal.

Port of apps/backend/src/routes/memory.ts. ``db.batch`` becomes sequential
statements in one request transaction (get_db_session commits at the end), so
upsert's supersession writes stay atomic.
"""

from __future__ import annotations

import uuid
from contextlib import suppress
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import delete, desc, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.app.middleware.consent import require_consent
from yomi.db.models_app import MemoryEmbedding, MemoryEntry, MemoryRelation, MemorySource
from yomi.db.models_auth import User
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend
from yomi.services.memory import d1_backend
from yomi.services.memory.common import (
    MAX_MEMORY_CHARS,
    UUID_PATTERN,
    _clamp_confidence,
    _clamp_limit,
    _clean,
    _forget_after_date,
    _from_api_body,
    _hash,
    _normalize_topic,  # noqa: F401 — re-exported; tests import helpers from this module
    relation_for_memory,
)
from yomi.services.memory.embeddings import embed_memory_text, memory_embedding_model
from yomi.services.memory.search import FULL_META_COLUMNS, build_recall_cte, memory_search_knobs

memory_router = APIRouter(prefix="/api/memory")


async def store_memory_embedding(
    session: AsyncSession, user_id: str, memory_id: uuid.UUID, text_value: str
) -> None:
    embedding = await embed_memory_text(text_value)
    if not embedding:
        return
    await session.execute(delete(MemoryEmbedding).where(MemoryEmbedding.memory_id == memory_id))
    session.add(
        MemoryEmbedding(
            user_id=user_id,
            memory_id=memory_id,
            model=memory_embedding_model(),
            embedding=embedding,
        )
    )


async def _prune_expired(session: AsyncSession, user_id: str) -> None:
    await session.execute(
        text(
            """
            update memory_entries
            set status = 'forgotten', updated_at = now()
            where user_id = :user_id
              and status = 'active'
              and forget_after is not null
              and forget_after < now()
            """
        ),
        {"user_id": user_id},
    )


def _memory_dict(row: MemoryEntry, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    out = {
        "id": row.id,
        "userId": row.user_id,
        "customId": row.custom_id,
        "contentHash": row.content_hash,
        "kind": row.kind,
        "scope": row.scope,
        "topic": row.topic,
        "summary": row.summary,
        "content": row.content,
        "contentTsv": row.content_tsv,
        "status": row.status,
        "confidence": row.confidence,
        "sourceType": row.source_type,
        "sourcePath": row.source_path,
        "version": row.version,
        "isLatest": row.is_latest,
        "isStatic": row.is_static,
        "rootMemoryId": row.root_memory_id,
        "parentMemoryId": row.parent_memory_id,
        "forgetAfter": row.forget_after,
        "metadata": row.metadata_,
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    }
    if extra:
        out.update(extra)
    return out


async def upsert_memory(
    session: AsyncSession, user_id: str, input_data: dict[str, Any]
) -> MemoryEntry | None:
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

    existing: MemoryEntry | None = None
    if input_data.get("id"):
        existing = (
            await session.execute(
                select(MemoryEntry)
                .where(
                    MemoryEntry.user_id == user_id,
                    MemoryEntry.id == _clean(input_data["id"], 80),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
    elif custom_id:
        existing = (
            await session.execute(
                select(MemoryEntry)
                .where(
                    MemoryEntry.user_id == user_id,
                    MemoryEntry.custom_id == custom_id,
                    MemoryEntry.is_latest.is_(True),
                )
                .limit(1)
            )
        ).scalar_one_or_none()

    # A turn-aware writer names what it replaces by id, judged against candidates
    # the model was shown (ADR 0006). An id that matches nothing costs the
    # supersession, never the memory — including a malformed one, which would
    # otherwise turn into a 22P02 that takes the whole write down.
    named_id = _clean(input_data.get("replacesId"), 80)
    replaces_id = named_id if UUID_PATTERN.match(named_id) else ""
    replaced: MemoryEntry | None = None
    if replaces_id and replaces_id != str(existing.id if existing else ""):
        replaced = (
            await session.execute(
                select(MemoryEntry)
                .where(
                    MemoryEntry.user_id == user_id,
                    MemoryEntry.id == replaces_id,
                    MemoryEntry.status == "active",
                    MemoryEntry.is_latest.is_(True),
                )
                .limit(1)
            )
        ).scalar_one_or_none()

    # A model that saw this turn already decided what it contradicts. Letting
    # topic equality fire as well would supersede the duplicates and elaborations
    # it deliberately left alone — the false positive the whole judgment exists
    # to avoid (ADR 0006).
    if input_data.get("modelJudged"):
        candidates: list[MemoryEntry] = []
    else:
        candidates = list(
            (
                await session.execute(
                    select(MemoryEntry)
                    .where(
                        MemoryEntry.user_id == user_id,
                        MemoryEntry.status == "active",
                        MemoryEntry.is_latest.is_(True),
                        or_(
                            MemoryEntry.topic.ilike(f"%{topic}%"),
                            MemoryEntry.summary.ilike(f"%{topic}%"),
                        ),
                    )
                    .order_by(desc(MemoryEntry.confidence), desc(MemoryEntry.updated_at))
                    .limit(8)
                )
            ).scalars()
        )

    existing_id = str(existing.id) if existing else None
    replaced_id = str(replaced.id) if replaced else None
    # Everything this save replaces: the row it versions over, the row a
    # turn-aware writer named, plus every active memory on the same topic.
    superseded: list[MemoryEntry] = [
        *(existing if existing is not None else []),
        *(replaced if replaced is not None else []),
        *[
            row
            for row in candidates
            if row.id != existing_id
            and row.id != replaced_id
            and relation_for_memory(input_data, _row_topic(row)) == "updates"
        ],
    ]
    parent: MemoryEntry | None = superseded[0] if superseded else None

    values = {
        "custom_id": custom_id or (existing.custom_id if existing else None),
        "content_hash": content_hash,
        "kind": _clean(input_data.get("kind") or "fact", 40) or "fact",
        "scope": _clean(input_data.get("scope") or "global", 80) or "global",
        "topic": topic,
        "summary": _clean(input_data.get("summary"), 500) if input_data.get("summary") else None,
        "content": content,
        "status": "active",
        "confidence": _clamp_confidence(input_data.get("confidence")),
        "source_type": (
            _clean(input_data.get("sourceType"), 80) if input_data.get("sourceType") else None
        ),
        "source_path": (
            _clean(input_data.get("sourcePath"), 500) if input_data.get("sourcePath") else None
        ),
        "is_static": input_data.get("isStatic") is True,
        "forget_after": _forget_after_date(input_data.get("forgetAfter")),
        "metadata_": input_data.get("metadata"),
    }

    inserted_id = uuid.uuid4()
    # Free the custom id first — (user_id, custom_id) is uniquely indexed where
    # it is not null, so the insert below would collide with the row it is
    # versioning over.
    if existing and existing.custom_id:
        await session.execute(
            update(MemoryEntry).where(MemoryEntry.id == existing.id).values(custom_id=None)
        )
    entry = MemoryEntry(
        id=inserted_id,
        user_id=user_id,
        version=parent.version + 1 if parent else 1,
        root_memory_id=(
            parent.root_memory_id
            if parent and parent.root_memory_id
            else (parent.id if parent else None)
        ),
        parent_memory_id=parent.id if parent else None,
        is_latest=True,
        **values,
    )
    session.add(entry)
    await session.flush()

    for superseded_row in superseded:
        await session.execute(
            update(MemoryEntry)
            .where(MemoryEntry.id == superseded_row.id)
            .values(status="superseded", is_latest=False, updated_at=datetime.now(UTC))
        )
        session.add(
            MemoryRelation(
                user_id=user_id,
                from_memory_id=inserted_id,
                to_memory_id=superseded_row.id,
                relation_type="updates",
            )
        )
    await session.flush()

    if input_data.get("sourcePath"):
        # best-effort: a stray source row must not sink the memory write
        with suppress(Exception):
            session.add(
                MemorySource(
                    memory_id=entry.id,
                    source_path=_clean(input_data["sourcePath"], 500),
                    relevance=100,
                )
            )
            await session.flush()

    # best-effort: embedding failure must not sink the memory write
    with suppress(Exception):
        await store_memory_embedding(
            session,
            user_id,
            entry.id,
            f"{entry.kind}: {entry.topic}\n{entry.summary or ''}\n{entry.content}",
        )
    return entry


def _row_topic(row: MemoryEntry) -> dict[str, Any]:
    return {"topic": row.topic}


async def _json_body(request: Request) -> dict[str, Any]:
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


@memory_router.post("/add", dependencies=[Depends(require_consent("memory"))])
async def memory_add(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    body = await _json_body(request)
    if d1 is not None:
        memory = await d1_backend.upsert(d1, user.id, _from_api_body(body))
        if memory is None:
            return JSONResponse(
                {"error": "content is required", "code": "invalid_content"}, status_code=400
            )
        return {"memory": memory}
    memory = await upsert_memory(db, user.id, _from_api_body(body))
    if memory is None:
        return JSONResponse(
            {"error": "content is required", "code": "invalid_content"}, status_code=400
        )
    return {"memory": _memory_dict(memory)}


@memory_router.get("/entries", dependencies=[Depends(require_consent("memory"))])
async def memory_entries(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    limit = _clamp_limit(request.query_params.get("limit"), 50, 200)
    if d1 is not None:
        await d1_backend.prune_expired(d1, user.id)
        return {"memories": await d1_backend.list_entries(d1, user.id, limit)}
    await _prune_expired(db, user.id)
    rows = (
        await db.execute(
            select(MemoryEntry)
            .where(
                MemoryEntry.user_id == user.id,
                MemoryEntry.status == "active",
                MemoryEntry.is_latest.is_(True),
            )
            .order_by(desc(MemoryEntry.is_static), desc(MemoryEntry.updated_at))
            .limit(limit)
        )
    ).scalars()
    return {"memories": [_memory_dict(r) for r in rows]}


# Superseded memories are gone from every other read path, so this is the only
# way back to one that was replaced by mistake — the data contract the memory
# viewer's undo will read.
@memory_router.get("/superseded", dependencies=[Depends(require_consent("memory"))])
async def memory_superseded(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    limit = _clamp_limit(request.query_params.get("limit"), 50, 200)
    if d1 is not None:
        return {"memories": await d1_backend.list_superseded(d1, user.id, limit)}
    rows = (
        await db.execute(
            select(MemoryEntry)
            .where(
                MemoryEntry.user_id == user.id,
                MemoryEntry.status == "superseded",
            )
            .order_by(desc(MemoryEntry.updated_at))
            .limit(limit)
        )
    ).scalars()
    rows = list(rows)
    if not rows:
        return {"memories": []}

    edges = (
        await db.execute(
            select(MemoryRelation.from_memory_id, MemoryRelation.to_memory_id).where(
                MemoryRelation.user_id == user.id,
                MemoryRelation.relation_type == "updates",
                MemoryRelation.to_memory_id.in_([row.id for row in rows]),
            )
        )
    ).all()
    edges = [{"fromMemoryId": f, "toMemoryId": t} for f, t in edges]
    replacements = (
        (
            await db.execute(
                select(MemoryEntry).where(
                    MemoryEntry.user_id == user.id,
                    MemoryEntry.id.in_([edge["fromMemoryId"] for edge in edges]),
                )
            )
        ).scalars().all()
        if edges
        else []
    )
    by_id = {str(r.id): r for r in replacements}
    replaced_by = {
        edge["toMemoryId"]: by_id.get(str(edge["fromMemoryId"]))
        for edge in edges
    }
    return {
        "memories": [
            _memory_dict(
                row,
                {
                    "replacedBy": (
                        _memory_dict(replaced_by[row.id])
                        if row.id in replaced_by and replaced_by[row.id]
                        else None
                    )
                },
            )
            for row in rows
        ]
    }


@memory_router.post("/search", dependencies=[Depends(require_consent("memory"))])
async def memory_search(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    body = await _json_body(request)
    query = _clean(body.get("query"), 400)
    limit = _clamp_limit(body.get("limit"), 8, 25)
    max_chars = _clamp_limit(body.get("maxChars"), 4000, 20_000)
    if d1 is not None:
        await d1_backend.prune_expired(d1, user.id)
        return {
            "memories": await d1_backend.search(d1, user.id, query, limit, max_chars)
        }
    await _prune_expired(db, user.id)

    if not query:
        rows = list(
            (
                await db.execute(
                    select(MemoryEntry)
                    .where(
                        MemoryEntry.user_id == user.id,
                        MemoryEntry.status == "active",
                        MemoryEntry.is_latest.is_(True),
                    )
                    .order_by(
                        desc(MemoryEntry.is_static),
                        desc(MemoryEntry.confidence),
                        desc(MemoryEntry.updated_at),
                    )
                    .limit(limit)
                )
            ).scalars()
        )
        return {"memories": [_memory_dict(r) for r in rows]}

    query_embedding = await embed_memory_text(query)
    knobs = memory_search_knobs()
    prefix = build_recall_cte(
        user_id=user.id,
        query=query,
        query_embedding=query_embedding,
        candidates=knobs["candidates"],
        rrf_k=knobs["rrf_k"],
        fused_limit=knobs["candidates"],
        meta_columns=FULL_META_COLUMNS,
    )
    tail = f"""
        select
          e.id as "id",
          e.user_id as "userId",
          e.custom_id as "customId",
          e.content_hash as "contentHash",
          e.kind as "kind",
          e.scope as "scope",
          e.topic as "topic",
          e.summary as "summary",
          e.content as "content",
          e.status as "status",
          e.confidence as "confidence",
          e.source_type as "sourceType",
          e.source_path as "sourcePath",
          e.version as "version",
          e.is_latest as "isLatest",
          e.is_static as "isStatic",
          e.root_memory_id as "rootMemoryId",
          e.parent_memory_id as "parentMemoryId",
          e.forget_after as "forgetAfter",
          e.metadata as "metadata",
          e.created_at as "createdAt",
          e.updated_at as "updatedAt",
          f.score as "score",
          f.matched_by as "matchedBy"
        from fused f
        join memory_entries e on e.id = f.memory_id
        order by e.is_static desc, f.score desc, e.confidence desc, e.updated_at desc
        limit {limit}
    """
    fetched = (
        await db.execute(
            text(prefix + "\n" + tail),
            {
                "user_id": user.id,
                "query": query,
                "candidates": knobs["candidates"],
                "rrf_k": knobs["rrf_k"],
                "fused_limit": knobs["candidates"],
            },
        )
    ).mappings()
    fetched = [dict(row) for row in fetched]

    memories: list[dict[str, Any]] = []
    used = 0
    for row_data in fetched:
        summary = row_data.get("summary") or ""
        serialized = (
            f"{row_data.get('kind') or ''}: {row_data.get('topic') or ''}\n"
            + (f"{summary}\n" if summary else "")
            + str(row_data.get("content") or "")
        )
        if used + len(serialized) > max_chars:
            break
        memories.append(row_data)
        used += len(serialized)
    return {"memories": memories}


@memory_router.post("/profile", dependencies=[Depends(require_consent("memory"))])
async def memory_profile(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    body = await _json_body(request)
    query = _clean(body.get("query"), 400)
    limit = _clamp_limit(body.get("limit"), 24, 80)
    if d1 is not None:
        await d1_backend.prune_expired(d1, user.id)
        return await d1_backend.profile(d1, user.id, query, limit)
    await _prune_expired(db, user.id)

    base_where = (
        MemoryEntry.user_id == user.id,
        MemoryEntry.status == "active",
        MemoryEntry.is_latest.is_(True),
    )
    static_rows = (
        await db.execute(
            select(MemoryEntry)
            .where(*base_where, MemoryEntry.is_static.is_(True))
            .order_by(desc(MemoryEntry.confidence), desc(MemoryEntry.updated_at))
            .limit(limit)
        )
    ).scalars().all()
    dynamic_rows = (
        await db.execute(
            select(MemoryEntry)
            .where(*base_where, MemoryEntry.is_static.is_(False))
            .order_by(desc(MemoryEntry.confidence), desc(MemoryEntry.updated_at))
            .limit(limit)
        )
    ).scalars().all()
    relevant = (
        (
            await db.execute(
                select(MemoryEntry)
                .where(
                    *base_where,
or_(
                            MemoryEntry.topic.ilike(f"%{query}%"),
                            MemoryEntry.content.ilike(f"%{query}%"),
                            MemoryEntry.summary.ilike(f"%{query}%"),
                        ),
                )
                .order_by(
                    desc(MemoryEntry.is_static),
                    desc(MemoryEntry.confidence),
                    desc(MemoryEntry.updated_at),
                )
                .limit(min(limit, 12))
            )
        ).scalars().all()
        if query
        else []
    )
    return {
        "profile": {
            "static": [r.summary or r.content for r in static_rows],
            "dynamic": [r.summary or r.content for r in dynamic_rows],
        },
        "memories": [_memory_dict(r) for r in relevant],
    }


@memory_router.patch("/{item_id}", dependencies=[Depends(require_consent("memory"))])
async def memory_patch(
    item_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    item_id = _clean(item_id, 80)
    body = await _json_body(request)
    if d1 is not None:
        existing = await d1_backend.fetch_entry(d1, user.id, item_id)
        if existing is None:
            return JSONResponse({"error": "memory not found", "code": "not_found"}, status_code=404)
        memory = await d1_backend.upsert(
            d1,
            user.id,
            {
                "customId": existing["customId"],
                "id": existing["id"],
                "kind": body.get("kind", existing["kind"]),
                "scope": body.get("scope", existing["scope"]),
                "topic": body.get("topic", existing["topic"]),
                "summary": body.get("summary", existing["summary"]),
                "content": body.get("content", existing["content"]),
                "confidence": body.get("confidence", existing["confidence"]),
                "sourceType": body.get("sourceType", existing["sourceType"]),
                "sourcePath": body.get("sourcePath", existing["sourcePath"]),
                "isStatic": body.get("isStatic", existing["isStatic"]),
                "forgetAfter": body.get("forgetAfter", existing["forgetAfter"]),
                "metadata": body.get("metadata", existing["metadata"]),
            },
        )
        return {"memory": memory}
    existing = (
        await db.execute(
            select(MemoryEntry)
            .where(MemoryEntry.user_id == user.id, MemoryEntry.id == item_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing is None:
        return JSONResponse({"error": "memory not found", "code": "not_found"}, status_code=404)

    memory = await upsert_memory(
        db,
        user.id,
        {
            "customId": existing.custom_id,
            "id": existing.id,
            "kind": body.get("kind", existing.kind),
            "scope": body.get("scope", existing.scope),
            "topic": body.get("topic", existing.topic),
            "summary": body.get("summary", existing.summary),
            "content": body.get("content", existing.content),
            "confidence": body.get("confidence", existing.confidence),
            "sourceType": body.get("sourceType", existing.source_type),
            "sourcePath": body.get("sourcePath", existing.source_path),
            "isStatic": body.get("isStatic", existing.is_static),
            "forgetAfter": body.get(
                "forgetAfter",
                existing.forget_after.isoformat() if existing.forget_after else None,
            ),
            "metadata": body.get("metadata", existing.metadata_),
        },
    )
    return {"memory": _memory_dict(memory) if memory else None}


@memory_router.post("/sync", dependencies=[Depends(require_consent("memory"))])
async def memory_sync(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    body = await _json_body(request)
    removed_ids = [_clean(item, 80) for item in (body.get("removedIds") or []) if _clean(item, 80)]
    removed_custom_ids = [
        _clean(item, 200) for item in (body.get("removedCustomIds") or []) if _clean(item, 200)
    ]
    if d1 is not None:
        synced: list[str] = []
        for item in body.get("memories") or []:
            if isinstance(item, dict):
                memory = await d1_backend.upsert(d1, user.id, _from_api_body(item))
                if memory:
                    synced.append(str(memory["id"]))
        removed = await d1_backend.sync_remove(d1, user.id, removed_ids, removed_custom_ids)
        return {"synced": len(synced), "ids": synced, "removed": removed}
    synced: list[str] = []
    for item in body.get("memories") or []:
        if isinstance(item, dict):
            memory = await upsert_memory(db, user.id, _from_api_body(item))
            if memory:
                synced.append(str(memory.id))

    removed = 0

    for item_id in removed_ids:
        res = await db.execute(
            update(MemoryEntry)
            .where(
                MemoryEntry.user_id == user.id,
                MemoryEntry.id == item_id,
                MemoryEntry.status == "active",
            )
            .values(status="forgotten", updated_at=datetime.now(UTC))
            .returning(MemoryEntry.id)
        )
        removed += len(res.all())
    for custom_item_id in removed_custom_ids:
        res = await db.execute(
            update(MemoryEntry)
            .where(
                MemoryEntry.user_id == user.id,
                MemoryEntry.custom_id == custom_item_id,
                MemoryEntry.status == "active",
            )
            .values(status="forgotten", updated_at=datetime.now(UTC))
            .returning(MemoryEntry.id)
        )
        removed += len(res.all())
    return {"synced": len(synced), "ids": synced, "removed": removed}


@memory_router.post("/forget")
async def memory_forget(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    body = await _json_body(request)
    item_id = _clean(body.get("id"), 80)
    custom_id = _clean(body.get("customId"), 200)
    query = _clean(body.get("query"), 400)
    if not item_id and not custom_id and not query:
        return JSONResponse(
            {"error": "id, customId, or query is required", "code": "invalid_target"},
            status_code=400,
        )
    if d1 is not None:
        return await d1_backend.forget(
            d1, user.id,
            item_id=item_id, custom_id=custom_id, query=query,
            hard=body.get("hard") is True,
        )

    if item_id:
        where = [MemoryEntry.user_id == user.id, MemoryEntry.id == item_id]
    elif custom_id:
        where = [MemoryEntry.user_id == user.id, MemoryEntry.custom_id == custom_id]
    else:
        where = [
            MemoryEntry.user_id == user.id,
            MemoryEntry.status == "active",
            or_(
                    MemoryEntry.topic.ilike(f"%{query}%"),
                    MemoryEntry.content.ilike(f"%{query}%"),
                ),
        ]

    if body.get("hard") is True:
        res = await db.execute(delete(MemoryEntry).where(*where).returning(MemoryEntry.id))
        ids = [str(row[0]) for row in res.all()]
        return {"deleted": len(ids), "ids": ids}
    res = await db.execute(
        update(MemoryEntry)
        .where(*where)
        .values(status="forgotten", updated_at=datetime.now(UTC))
        .returning(MemoryEntry.id)
    )
    ids = [str(row[0]) for row in res.all()]
    return {"forgotten": len(ids), "ids": ids}


@memory_router.post("/graph-walk", dependencies=[Depends(require_consent("memory"))])
async def memory_graph_walk(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    body = await _json_body(request)
    root_id = _clean(body.get("rootId"), 80)
    if not root_id:
        return JSONResponse({"error": "rootId is required"}, status_code=400)
    try:
        max_depth = min(max(int(body.get("maxDepth") or 3), 1), 6)
        max_nodes = min(max(int(body.get("maxNodes") or 16), 1), 48)
    except (TypeError, ValueError):
        max_depth, max_nodes = 3, 16
    if d1 is not None:
        return await d1_backend.graph_walk(d1, user.id, root_id, max_depth, max_nodes)

    visited: set[str] = set()
    chain: list[dict[str, Any]] = []
    branched: list[dict[str, Any]] = []

    async def walk(node_id: str, depth: int) -> None:
        if node_id in visited or depth > max_depth or len(visited) >= max_nodes:
            return
        visited.add(node_id)
        relations = (
            await db.execute(
                select(MemoryRelation.to_memory_id, MemoryRelation.relation_type)
                .where(
                    MemoryRelation.user_id == user.id,
                    MemoryRelation.from_memory_id == node_id,
                )
                .limit(10)
            )
        ).all()
        entry = (
            await db.execute(
                select(MemoryEntry)
                .where(MemoryEntry.id == node_id, MemoryEntry.user_id == user.id)
                .limit(1)
            )
        ).scalar_one_or_none()
        if entry is None:
            return
        node = {
            "id": entry.id,
            "kind": entry.kind,
            "scope": entry.scope,
            "topic": entry.topic,
            # Guaranteed `updates` edges make superseded rows reliably reachable
            # here — say which ones they are rather than passing them off as current.
            "status": entry.status,
            "content": entry.content,
            "confidence": entry.confidence,
            "isStatic": entry.is_static,
            "updatedAt": entry.updated_at.isoformat(),
            "relations": [{"targetId": t, "relationType": r} for t, r in relations],
        }
        if depth == 0:
            chain.append(node)
        else:
            branched.append(node)
        for rel in relations:
            await walk(rel[0], depth + 1)

    await walk(root_id, 0)
    return {"root": chain[0] if chain else None, "chain": chain, "branched": branched}


@memory_router.delete("/{item_id}")
async def memory_delete(
    item_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    item_id = _clean(item_id, 80)
    hard = request.query_params.get("hard") == "1"
    if d1 is not None:
        return await d1_backend.forget(d1, user.id, item_id=item_id, hard=hard)
    if hard:
        res = await db.execute(
            delete(MemoryEntry)
            .where(MemoryEntry.user_id == user.id, MemoryEntry.id == item_id)
            .returning(MemoryEntry.id)
        )
        ids = [str(row[0]) for row in res.all()]
        return {"deleted": len(ids), "ids": ids}
    res = await db.execute(
        update(MemoryEntry)
        .where(
            MemoryEntry.user_id == user.id,
            MemoryEntry.id == item_id,
            MemoryEntry.status == "active",
        )
        .values(status="forgotten", updated_at=datetime.now(UTC))
        .returning(MemoryEntry.id)
    )
    ids = [str(row[0]) for row in res.all()]
    return {"forgotten": len(ids), "ids": ids}