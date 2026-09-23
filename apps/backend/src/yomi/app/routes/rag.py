"""/api/rag — Cloud RAG router.

Port of apps/backend/src/routes/rag.ts.
"""

from __future__ import annotations

import math
import os
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.app.middleware.consent import require_consent
from yomi.conf import settings
from yomi.db.models_app import RagChunk, RagDocument, RagEmbedding, RagRetrievalLog, RagSource
from yomi.db.models_auth import User
from yomi.lib.rerank import RerankCandidate, llm_rerank, mmr_rerank, parse_vector
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend
from yomi.services.entitlements import effective_plan_for_user
from yomi.services.rag import d1_backend
from yomi.services.rag.common import (
    MAX_DOCUMENT_CHARS,
    MIRROR_SOURCE_TYPE,
    RAG_CANDIDATES,
    RAG_MMR_LAMBDA,
    RAG_RRF_K,
    _clean,
    _hash,
    _source_hash,
)
from yomi.services.rag.embeddings import DEFAULT_EMBEDDING_MODEL, chunk_text, embed_text
from yomi.services.rag.index_document import IndexDocumentInput, index_document

rag_router = APIRouter(prefix="/api/rag")


def _rag_allowed(user: User) -> bool:
    return effective_plan_for_user({"plan": user.plan}) in ("pro", "max")


def _vector_literal(values: list[float]) -> str:
    parts = []
    for v in values:
        if math.isfinite(v):
            parts.append(f"{v:.8f}")
        else:
            parts.append("0")
    return "[" + ",".join(parts) + "]"


async def _find_source(
    session: AsyncSession, user_id: str, name: str, source_type: str = MIRROR_SOURCE_TYPE
) -> RagSource | None:
    return (
        await session.execute(
            select(RagSource)
            .where(
                RagSource.user_id == user_id,
                RagSource.path == name,
                RagSource.source_type == source_type,
            )
            .limit(1)
        )
    ).scalar_one_or_none()


async def _upsert_mirror_source(
    session: AsyncSession, user_id: str, source: dict[str, Any]
) -> bool:
    name = _clean(str(source.get("path", "")), 500)
    raw_path = str(source.get("path", ""))
    raw_title = source.get("title") or raw_path.split("/")[-1] or raw_path
    title = _clean(str(raw_title), 200)
    content = _clean(str(source.get("content", "")), MAX_DOCUMENT_CHARS)
    content_hash = _source_hash(str(source.get("path", "")), str(source.get("content", "")))
    existing = await _find_source(session, user_id, name)

    if existing is not None:
        await session.execute(
            update(RagSource)
            .where(RagSource.id == existing.id)
            .values(
                name=title,
                path=name,
                content_hash=content_hash,
                source_type=MIRROR_SOURCE_TYPE,
                status="ready",
            )
        )
        await session.flush()
        mirrored_id = existing.id
    else:
        source_row = RagSource(
            user_id=user_id,
            name=title,
            path=name,
            content_hash=content_hash,
            source_type=MIRROR_SOURCE_TYPE,
            privacy_scope="cloud_rag",
            status="ready",
        )
        session.add(source_row)
        await session.flush()
        mirrored_id = source_row.id

    if mirrored_id is None:
        return False

    await index_document(
        session,
        IndexDocumentInput(
            user_id=user_id,
            source_id=mirrored_id,
            external_id=str(source.get("path", "")),
            title=title,
            mime_type="text/markdown",
            text=content,
            metadata_={
                "path": source.get("path"),
                "updatedAt": source.get("updatedAt"),
                "origin": "cloud_archive",
            },
        ),
    )
    return True


async def _delete_mirror_source(session: AsyncSession, user_id: str, name: str) -> bool:
    source = await _find_source(session, user_id, name)
    if source is None:
        return False
    await session.execute(delete(RagDocument).where(RagDocument.source_id == source.id))
    await session.execute(
        update(RagSource).where(RagSource.id == source.id).values(status="deleted")
    )
    await session.flush()
    return True


@rag_router.post("/sources", dependencies=[Depends(require_consent("cloud_memory"))])
async def create_source(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if not _rag_allowed(user):
        return JSONResponse({"error": "Cloud RAG requires Pro", "code": "upgrade_required"}, 403)

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 — Hono's c.req.json().catch(() => ({}))
        body = {}
    if not isinstance(body, dict):
        body = {}
    name = _clean(str(body.get("name", "")), 120)
    source_type = _clean(str(body.get("sourceType", "manual")), 40)
    if not name:
        return JSONResponse({"error": "name is required", "code": "invalid_name"}, 400)
    if d1 is not None:
        return await d1_backend.create_source(d1, user.id, name, source_type)

    source = RagSource(user_id=user.id, name=name, source_type=source_type, status="ready")
    session.add(source)
    await session.flush()
    return _source_json(source)


@rag_router.get("/sources", dependencies=[Depends(require_consent("cloud_memory"))])
async def list_sources(
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if not _rag_allowed(user):
        return JSONResponse({"error": "Cloud RAG requires Pro", "code": "upgrade_required"}, 403)
    if d1 is not None:
        return {"sources": await d1_backend.list_sources(d1, user.id)}

    result = await session.execute(
        text(
            """
            select
              s.id as "id",
              s.name as "name",
              s.path as "path",
              s.content_hash as "contentHash",
              s.source_type as "sourceType",
              s.status as "status",
              count(distinct d.id)::int as "documentCount",
              count(c.id)::int as "chunkCount",
              s.created_at as "createdAt",
              s.updated_at as "updatedAt"
            from rag_sources s
            left join rag_documents d on d.source_id = s.id
            left join rag_chunks c on c.document_id = d.id
            where s.user_id = :user_id and s.status <> 'deleted'
            group by s.id
            order by s.updated_at desc
            """
        ),
        {"user_id": user.id},
    )
    rows = [dict(row) for row in result.mappings()]
    return {"sources": rows}


@rag_router.post("/sync", dependencies=[Depends(require_consent("cloud_memory"))])
async def sync_sources(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if not _rag_allowed(user):
        return JSONResponse({"error": "Cloud RAG requires Pro", "code": "upgrade_required"}, 403)

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    if not isinstance(body, dict):
        body = {}
    sources = body.get("sources") if isinstance(body.get("sources"), list) else []
    removed_paths = body.get("removedPaths") if isinstance(body.get("removedPaths"), list) else []

    if d1 is not None:
        synced = 0
        for source in sources:
            if not isinstance(source, dict):
                continue
            path = _clean(str(source.get("path", "")), 500)
            content = _clean(str(source.get("content", "")), MAX_DOCUMENT_CHARS)
            if not path or not content:
                continue
            if await d1_backend.upsert_mirror_source(d1, user.id, source):
                synced += 1
        removed = 0
        for path in removed_paths:
            if await d1_backend.delete_mirror_source(d1, user.id, _clean(str(path), 500)):
                removed += 1
        return {"synced": synced, "removed": removed}

    synced = 0
    for source in sources:
        if not isinstance(source, dict):
            continue
        path = _clean(str(source.get("path", "")), 500)
        content = _clean(str(source.get("content", "")), MAX_DOCUMENT_CHARS)
        if not path or not content:
            continue
        ok = await _upsert_mirror_source(session, user.id, source)
        if ok:
            synced += 1

    removed = 0
    for path in removed_paths:
        ok = await _delete_mirror_source(session, user.id, _clean(str(path), 500))
        if ok:
            removed += 1

    return {"synced": synced, "removed": removed}


@rag_router.post("/documents", dependencies=[Depends(require_consent("cloud_memory"))])
async def create_document(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if not _rag_allowed(user):
        return JSONResponse({"error": "Cloud RAG requires Pro", "code": "upgrade_required"}, 403)

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    if not isinstance(body, dict):
        body = {}
    source_id = body.get("sourceId")
    title = _clean(str(body.get("title", "Untitled")), 200)
    content = _clean(str(body.get("content", "")), MAX_DOCUMENT_CHARS)
    if not source_id:
        return JSONResponse({"error": "sourceId is required", "code": "invalid_source"}, 400)
    if not content:
        return JSONResponse({"error": "content is required", "code": "invalid_content"}, 400)
    if d1 is not None:
        metadata_value = body.get("metadata") if isinstance(body.get("metadata"), dict) else None
        mime_type = body.get("mimeType") if isinstance(body.get("mimeType"), str) else "text/plain"
        try:
            document, chunks = await d1_backend.push_document(
                d1, user.id, source_id, title, mime_type, content, metadata_value
            )
        except LookupError:
            return JSONResponse({"error": "Source not found", "code": "source_not_found"}, 404)
        return {"document": document, "chunks": chunks}

    source = (
        await session.execute(
            select(RagSource.id)
            .where(
                RagSource.id == source_id,
                RagSource.user_id == user.id,
                RagSource.status == "ready",
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if source is None:
        return JSONResponse({"error": "Source not found", "code": "source_not_found"}, 404)

    metadata_value = body.get("metadata") if isinstance(body.get("metadata"), dict) else None
    mime_type = body.get("mimeType") if isinstance(body.get("mimeType"), str) else "text/plain"
    upsert = (
        pg_insert(RagDocument)
        .values(
            user_id=user.id,
            source_id=source_id,
            title=title,
            mime_type=mime_type,
            content_hash=_hash(content),
            metadata_=metadata_value,
        )
        .on_conflict_do_update(
            index_elements=["source_id", "content_hash"],
            set_={"title": title, "metadata_": metadata_value},
        )
        .returning(RagDocument)
    )
    document = (await session.execute(upsert)).scalar_one_or_none()
    if document is None:
        return JSONResponse({"error": "Document insert failed"}, 500)

    await session.execute(delete(RagChunk).where(RagChunk.document_id == document.id))
    await session.flush()

    model = settings.workers_ai_embedding_model or DEFAULT_EMBEDDING_MODEL
    chunks = chunk_text(content)
    for chunk_index, chunk in enumerate(chunks):
        created = RagChunk(
            user_id=user.id,
            document_id=document.id,
            chunk_index=chunk_index,
            content=chunk,
            token_count=math.ceil(len(chunk) / 4),
        )
        session.add(created)
        await session.flush()
        embedding = await embed_text(chunk)
        session.add(
            RagEmbedding(
                user_id=user.id,
                chunk_id=created.id,
                model=model,
                embedding=embedding,
            )
        )
    await session.flush()

    return {"document": _document_json(document), "chunks": len(chunks)}


@rag_router.post("/search", dependencies=[Depends(require_consent("cloud_memory"))])
async def search(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if not _rag_allowed(user):
        return JSONResponse({"error": "Cloud RAG requires Pro", "code": "upgrade_required"}, 403)

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    if not isinstance(body, dict):
        body = {}
    query = _clean(str(body.get("query", "")), 1000)
    if not query:
        return JSONResponse({"error": "query is required", "code": "invalid_query"}, 400)
    try:
        limit = max(1, min(int(body.get("limit", 5)), 10))
    except (TypeError, ValueError):
        limit = 5
    try:
        max_chars = max(500, min(int(body.get("maxChars", 3000)), 8000))
    except (TypeError, ValueError):
        max_chars = 3000
    if d1 is not None:
        return {
            "snippets": await d1_backend.search(d1, user.id, query, limit, max_chars)
        }

    query_vec = await embed_text(query)
    embedding = _vector_literal(query_vec)

    result = await session.execute(
        text(
            """
            with vec as (
              select e.chunk_id,
                     row_number() over (order by e.embedding <=> :embedding::vector) as rnk
              from rag_embeddings e
              where e.user_id = :user_id
              order by e.embedding <=> :embedding::vector
              limit :candidates
            ),
            kw as (
              select c.id as chunk_id,
                     row_number() over (
                       order by ts_rank_cd(c.content_tsv,
                         websearch_to_tsquery('english', :query)) desc
                     ) as rnk
              from rag_chunks c
              where c.user_id = :user_id
                and c.content_tsv @@ websearch_to_tsquery('english', :query)
              limit :candidates
            ),
            fused as (
              select chunk_id, sum(1.0 / (:rrf_k + rnk)) as score
              from (select chunk_id, rnk from vec union all select chunk_id, rnk from kw) u
              group by chunk_id
              order by score desc
              limit :candidates
            )
            select
              c.id as "chunkId",
              d.id as "documentId",
              s.id as "sourceId",
              s.name as "sourceName",
              d.title as "title",
              c.content as "content",
              f.score as "score",
              e.embedding::text as "embedding"
            from fused f
            join rag_chunks c on c.id = f.chunk_id
            join rag_documents d on d.id = c.document_id
            join rag_sources s on s.id = d.source_id
            join rag_embeddings e on e.chunk_id = c.id
            where s.status in ('ready', 'active', 'backfilling')
            order by f.score desc
            """
        ),
        {
            "embedding": embedding,
            "user_id": user.id,
            "query": query,
            "candidates": RAG_CANDIDATES,
            "rrf_k": RAG_RRF_K,
        },
    )
    rows = [dict(row) for row in result.mappings()]

    candidates: list[RerankCandidate] = [
        RerankCandidate(
            chunk_id=r["chunkId"],
            content=r["content"],
            embedding=parse_vector(r["embedding"]),
        )
        for r in rows
    ]
    if os.environ.get("RAG_RERANK_LLM") == "true":
        reranked = await llm_rerank(query, candidates, limit)
        if reranked is None:
            reranked = mmr_rerank(query_vec, candidates, limit, RAG_MMR_LAMBDA)
    else:
        reranked = mmr_rerank(query_vec, candidates, limit, RAG_MMR_LAMBDA)

    by_id = {r["chunkId"]: r for r in rows}
    snippets: list[dict[str, Any]] = []
    used = 0
    for cand in reranked:
        row = by_id.get(cand.chunk_id)
        if row is None:
            continue
        content = str(row["content"])
        if used + len(content) > max_chars:
            break
        snippets.append(
            {
                "chunkId": row["chunkId"],
                "documentId": row["documentId"],
                "sourceId": row["sourceId"],
                "sourceName": row["sourceName"],
                "title": row["title"],
                "content": content,
                "score": row["score"],
                "marker": len(snippets) + 1,
            }
        )
        used += len(content)

    try:
        session.add(
            RagRetrievalLog(
                user_id=user.id,
                query_hash=_hash(query),
                matched_chunk_ids=[str(s["chunkId"]) for s in snippets],
            )
        )
        await session.flush()
    except Exception:  # noqa: BLE001 — best-effort logging
        pass  # ignore

    return {"snippets": snippets}


@rag_router.delete("/sources/{source_id}")
async def delete_source(
    source_id: str,
    session: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if not _rag_allowed(user):
        return JSONResponse({"error": "Cloud RAG requires Pro", "code": "upgrade_required"}, 403)
    if d1 is not None:
        if not await d1_backend.delete_source(d1, user.id, source_id):
            return JSONResponse({"error": "Source not found", "code": "source_not_found"}, 404)
        return {"ok": True}

    deleted = (
        await session.execute(
            update(RagSource)
            .where(RagSource.id == source_id, RagSource.user_id == user.id)
            .values(status="deleted")
            .returning(RagSource.id)
        )
    ).scalar_one_or_none()
    if deleted is None:
        return JSONResponse({"error": "Source not found", "code": "source_not_found"}, 404)

    # Hard-delete the source's documents so a later re-index into the same
    # (userId, path) slot can't resurrect them into visibility (#100) —
    # rag_chunks and rag_embeddings cascade-delete via their FK onDelete rules.
    await session.execute(delete(RagDocument).where(RagDocument.source_id == deleted))
    await session.flush()

    return {"ok": True}


def _source_json(source: RagSource) -> dict[str, Any]:
    return {
        "id": str(source.id),
        "userId": source.user_id,
        "name": source.name,
        "path": source.path,
        "contentHash": source.content_hash,
        "sourceType": source.source_type,
        "privacyScope": source.privacy_scope,
        "status": source.status,
        "createdAt": source.created_at,
        "updatedAt": source.updated_at,
    }


def _document_json(document: RagDocument) -> dict[str, Any]:
    return {
        "id": str(document.id),
        "userId": document.user_id,
        "sourceId": str(document.source_id),
        "title": document.title,
        "mimeType": document.mime_type,
        "contentHash": document.content_hash,
        "externalId": document.external_id,
        "metadata": document.metadata_,
        "createdAt": document.created_at,
        "updatedAt": document.updated_at,
    }