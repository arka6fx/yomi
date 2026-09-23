"""D1 + Vectorize implementation of the Cloud RAG storage paths.

Mirrors ``yomi.app.routes.rag`` and ``yomi.services.rag.index_document``:

- documents/chunks/sources live in D1; chunk vectors live in Vectorize,
  keyed ``recordId = chunk id``, ``revision = "v1"``
- every indexing batch carries its vector outbox ops in the same D1 batch
- deletes enqueue vector deletes (Vectorize has no FK cascade)
- search fuses Vectorize candidates (with values for MMR) + keyword
  word-OR candidates with RRF, then applies the same MMR rerank

Embeddings stay provider-backed via ``embed_text`` (injectable for tests).
"""

from __future__ import annotations

import math
import os
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from yomi.lib.rerank import RerankCandidate, llm_rerank, mmr_rerank
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import utcnow_iso
from yomi.services.memory.common import _escape_like
from yomi.services.memory.d1_backend import keyword_words, rrf_fuse
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
from yomi.services.rag.embeddings import chunk_text, embed_text
from yomi.services.rag.index_document import (
    IndexDocumentInput,
    content_hash_for,
    sanitize_text,
)

VECTOR_REVISION = "v1"
_ACTIVE_SOURCE = "s.status IN ('ready', 'active', 'backfilling')"

EmbedFn = Callable[[str], Awaitable[list[float]]]


def source_json(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "userId": row["user_id"],
        "name": row["name"],
        "path": row["path"],
        "contentHash": row["content_hash"],
        "sourceType": row["source_type"],
        "privacyScope": row.get("privacy_scope"),
        "status": row["status"],
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def document_json(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "userId": row["user_id"],
        "sourceId": str(row["source_id"]),
        "title": row["title"],
        "mimeType": row["mime_type"],
        "contentHash": row["content_hash"],
        "externalId": row.get("external_id"),
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


def _vector_upsert_op(user_id: str, chunk_id: str, values: list[float], now: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "kind": "rag",
        "record_id": chunk_id,
        "revision": VECTOR_REVISION,
        "operation": "upsert",
        "payload": {"values": [float(v) for v in values]},
        "attempts": 0,
        "last_error": None,
        "created_at": now,
        "processed_at": None,
    }


def _vector_delete_op(user_id: str, chunk_id: str, now: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "kind": "rag",
        "record_id": chunk_id,
        "revision": VECTOR_REVISION,
        "operation": "delete",
        "payload": None,
        "attempts": 0,
        "last_error": None,
        "created_at": now,
        "processed_at": None,
    }


async def create_source(
    backend: D1Backend, user_id: str, name: str, source_type: str
) -> dict[str, Any]:
    now = utcnow_iso()
    row = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "name": name,
        "path": None,
        "content_hash": None,
        "source_type": source_type,
        "privacy_scope": "cloud_rag",
        "status": "ready",
        "sync_state": None,
        "created_at": now,
        "updated_at": now,
    }
    await backend.store.atomic([backend.store.insert("rag_sources", row)])
    return source_json(row)


async def list_sources(backend: D1Backend, user_id: str) -> list[dict[str, Any]]:
    rows = await backend.store.fetch_all(
        "SELECT s.id AS id, s.name AS name, s.path AS path, "
        "s.content_hash AS contentHash, s.source_type AS sourceType, s.status AS status, "
        "COUNT(DISTINCT d.id) AS documentCount, COUNT(c.id) AS chunkCount, "
        "s.created_at AS createdAt, s.updated_at AS updatedAt "
        "FROM rag_sources s "
        "LEFT JOIN rag_documents d ON d.source_id = s.id "
        "LEFT JOIN rag_chunks c ON c.document_id = d.id "
        "WHERE s.user_id = ? AND s.status <> 'deleted' "
        "GROUP BY s.id ORDER BY s.updated_at DESC",
        [user_id],
    )
    return rows


async def find_source(
    backend: D1Backend, user_id: str, name: str, source_type: str = MIRROR_SOURCE_TYPE
) -> dict | None:
    return await backend.store.fetch_one(
        "SELECT * FROM rag_sources WHERE user_id = ? AND path = ? AND source_type = ? LIMIT 1",
        [user_id, name, source_type],
    )


async def upsert_mirror_source(
    backend: D1Backend,
    user_id: str,
    source: dict[str, Any],
    embed: EmbedFn = embed_text,
) -> bool:
    name = _clean(str(source.get("path", "")), 500)
    raw_path = str(source.get("path", ""))
    raw_title = source.get("title") or raw_path.split("/")[-1] or raw_path
    title = _clean(str(raw_title), 200)
    content = _clean(str(source.get("content", "")), MAX_DOCUMENT_CHARS)
    content_hash = _source_hash(str(source.get("path", "")), str(source.get("content", "")))
    existing = await find_source(backend, user_id, name)
    now = utcnow_iso()
    if existing is not None:
        await backend.store.atomic([
            Statement(
                "UPDATE rag_sources SET name = ?, path = ?, content_hash = ?, "
                "source_type = ?, status = 'ready', updated_at = ? WHERE id = ?",
                [title, name, content_hash, MIRROR_SOURCE_TYPE, now, existing["id"]],
            )
        ])
        source_id = str(existing["id"])
    else:
        source_id = str(uuid.uuid4())
        await backend.store.atomic([
            backend.store.insert("rag_sources", {
                "id": source_id,
                "user_id": user_id,
                "name": title,
                "path": name,
                "content_hash": content_hash,
                "source_type": MIRROR_SOURCE_TYPE,
                "privacy_scope": "cloud_rag",
                "status": "ready",
                "sync_state": None,
                "created_at": now,
                "updated_at": now,
            })
        ])
    await index_document_d1(
        backend,
        IndexDocumentInput(
            user_id=user_id,
            source_id=source_id,
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
        embed=embed,
    )
    return True


async def delete_mirror_source(backend: D1Backend, user_id: str, name: str) -> bool:
    source = await find_source(backend, user_id, name)
    if source is None:
        return False
    await _delete_documents_of_source(backend, user_id, str(source["id"]))
    await backend.store.atomic([
        Statement(
            "UPDATE rag_sources SET status = 'deleted', updated_at = ? WHERE id = ?",
            [utcnow_iso(), source["id"]],
        )
    ])
    return True


async def _chunk_ids_of_documents(
    backend: D1Backend, document_ids: list[str]
) -> list[dict[str, str]]:
    if not document_ids:
        return []
    placeholders = ", ".join("?" for _ in document_ids)
    return await backend.store.fetch_all(
        f"SELECT id, user_id FROM rag_chunks WHERE document_id IN ({placeholders})",
        document_ids,
    )


async def _delete_documents_of_source(
    backend: D1Backend, user_id: str, source_id: str
) -> None:
    docs = await backend.store.fetch_all(
        "SELECT id FROM rag_documents WHERE source_id = ?", [source_id]
    )
    doc_ids = [str(d["id"]) for d in docs]
    now = utcnow_iso()
    statements: list[Statement] = []
    for chunk in await _chunk_ids_of_documents(backend, doc_ids):
        statements.append(
            backend.store.insert(
                "vector_sync_outbox", _vector_delete_op(user_id, str(chunk["id"]), now)
            )
        )
    for doc_id in doc_ids:
        statements.append(Statement("DELETE FROM rag_documents WHERE id = ?", [doc_id]))
    if statements:
        await backend.store.atomic(statements)


async def delete_source(backend: D1Backend, user_id: str, source_id: str) -> bool:
    existing = await backend.store.fetch_one(
        "SELECT id FROM rag_sources WHERE id = ? AND user_id = ? LIMIT 1",
        [source_id, user_id],
    )
    if existing is None:
        return False
    await _delete_documents_of_source(backend, user_id, source_id)
    await backend.store.atomic([
        Statement(
            "UPDATE rag_sources SET status = 'deleted', updated_at = ? WHERE id = ?",
            [utcnow_iso(), source_id],
        )
    ])
    return True


async def index_document_d1(
    backend: D1Backend,
    input_: IndexDocumentInput,
    embed: EmbedFn = embed_text,
) -> dict[str, Any]:
    """D1 counterpart of ``index_document``: same hashing/chunking, chunk
    vectors go to the outbox instead of ``rag_embeddings``."""
    text = sanitize_text(input_.text)
    content_hash = content_hash_for(input_.external_id, text)

    existing = await backend.store.fetch_one(
        "SELECT id, content_hash FROM rag_documents WHERE source_id = ? AND external_id = ? "
        "LIMIT 1",
        [input_.source_id, input_.external_id],
    )
    if existing is not None and existing.get("content_hash") == content_hash:
        return {"status": "unchanged", "documentId": str(existing["id"])}
    if existing is not None:
        await _delete_single_document(backend, input_.user_id, str(existing["id"]))

    now = utcnow_iso()
    document_id = str(uuid.uuid4())
    await backend.store.atomic([
        backend.store.insert("rag_documents", {
            "id": document_id,
            "user_id": input_.user_id,
            "source_id": input_.source_id,
            "title": input_.title,
            "mime_type": input_.mime_type,
            "content_hash": content_hash,
            "external_id": input_.external_id,
            "metadata": input_.metadata_,
            "created_at": now,
            "updated_at": now,
        })
    ])

    statements: list[Statement] = []
    for chunk_index, chunk in enumerate(chunk_text(text)):
        chunk_id = str(uuid.uuid4())
        statements.append(backend.store.insert("rag_chunks", {
            "id": chunk_id,
            "user_id": input_.user_id,
            "document_id": document_id,
            "chunk_index": chunk_index,
            "content": chunk,
            "token_count": math.ceil(len(chunk) / 4),
            "metadata": input_.metadata_,
            "created_at": now,
        }))
        embedding = await embed(chunk)
        statements.append(
            backend.store.insert(
                "vector_sync_outbox",
                _vector_upsert_op(input_.user_id, chunk_id, embedding, now),
            )
        )
        if len(statements) >= 80:
            await backend.store.atomic(statements)
            statements = []
    if statements:
        await backend.store.atomic(statements)
    return {"status": "indexed", "documentId": document_id}


async def _delete_single_document(
    backend: D1Backend, user_id: str, document_id: str
) -> None:
    now = utcnow_iso()
    statements = [
        backend.store.insert(
            "vector_sync_outbox", _vector_delete_op(user_id, str(chunk["id"]), now)
        )
        for chunk in await _chunk_ids_of_documents(backend, [document_id])
    ]
    statements.append(Statement("DELETE FROM rag_documents WHERE id = ?", [document_id]))
    await backend.store.atomic(statements)


async def delete_document_by_external_id(
    backend: D1Backend, user_id: str, source_id: str, external_id: str
) -> bool:
    existing = await backend.store.fetch_one(
        "SELECT id FROM rag_documents WHERE source_id = ? AND external_id = ? LIMIT 1",
        [source_id, external_id],
    )
    if existing is None:
        return False
    await _delete_single_document(backend, user_id, str(existing["id"]))
    return True


async def push_document(
    backend: D1Backend,
    user_id: str,
    source_id: str,
    title: str,
    mime_type: str,
    content: str,
    metadata_value: dict | None,
    embed: EmbedFn = embed_text,
) -> tuple[dict, int]:
    """D1 counterpart of the manual ``POST /documents`` push path: upsert by
    (source_id, content_hash), replace chunks, vectors via outbox."""
    source = await backend.store.fetch_one(
        "SELECT id FROM rag_sources WHERE id = ? AND user_id = ? AND status = 'ready' "
        "LIMIT 1",
        [source_id, user_id],
    )
    if source is None:
        raise LookupError("source_not_found")
    content_hash = _hash(content)
    now = utcnow_iso()
    existing = await backend.store.fetch_one(
        "SELECT id FROM rag_documents WHERE source_id = ? AND content_hash = ? LIMIT 1",
        [source_id, content_hash],
    )
    if existing is not None:
        document_id = str(existing["id"])
        await backend.store.atomic([
            Statement(
                "UPDATE rag_documents SET title = ?, metadata = ?, updated_at = ? WHERE id = ?",
                [title, metadata_value, now, document_id],
            )
        ])
        await _delete_chunks_of_document(backend, user_id, document_id)
    else:
        document_id = str(uuid.uuid4())
        await backend.store.atomic([
            backend.store.insert("rag_documents", {
                "id": document_id,
                "user_id": user_id,
                "source_id": source_id,
                "title": title,
                "mime_type": mime_type,
                "content_hash": content_hash,
                "external_id": None,
                "metadata": metadata_value,
                "created_at": now,
                "updated_at": now,
            })
        ])

    statements: list[Statement] = []
    count = 0
    for chunk_index, chunk in enumerate(chunk_text(content)):
        chunk_id = str(uuid.uuid4())
        statements.append(backend.store.insert("rag_chunks", {
            "id": chunk_id,
            "user_id": user_id,
            "document_id": document_id,
            "chunk_index": chunk_index,
            "content": chunk,
            "token_count": math.ceil(len(chunk) / 4),
            "metadata": metadata_value,
            "created_at": now,
        }))
        embedding = await embed(chunk)
        statements.append(
            backend.store.insert(
                "vector_sync_outbox",
                _vector_upsert_op(user_id, chunk_id, embedding, now),
            )
        )
        count = chunk_index + 1
        if len(statements) >= 80:
            await backend.store.atomic(statements)
            statements = []
    if statements:
        await backend.store.atomic(statements)
    row = await backend.store.fetch_one(
        "SELECT * FROM rag_documents WHERE id = ? LIMIT 1", [document_id]
    )
    assert row is not None
    return document_json(row), count


async def _delete_chunks_of_document(
    backend: D1Backend, user_id: str, document_id: str
) -> None:
    now = utcnow_iso()
    statements = [
        backend.store.insert(
            "vector_sync_outbox", _vector_delete_op(user_id, str(chunk["id"]), now)
        )
        for chunk in await _chunk_ids_of_documents(backend, [document_id])
    ]
    statements.append(Statement("DELETE FROM rag_chunks WHERE document_id = ?", [document_id]))
    await backend.store.atomic(statements)


async def search(
    backend: D1Backend,
    user_id: str,
    query: str,
    limit: int,
    max_chars: int,
    embed: EmbedFn = embed_text,
) -> list[dict[str, Any]]:
    """Hybrid retrieval: Vectorize (with values for MMR) + keyword word-OR,
    fused with RRF, then the same MMR rerank as the Postgres path."""
    query_vec = await embed(query)
    vec_matches = await backend.client.vector_query(
        user_id, "rag", query_vec, limit=RAG_CANDIDATES, return_values=True
    )
    vec_by_id: dict[str, dict] = {}
    for match in vec_matches:
        record_id = match.get("recordId")
        if isinstance(record_id, str):
            vec_by_id[str(record_id)] = match

    words = [w.lower() for w in keyword_words(query)]
    keyword_ids: list[str] = []
    if words:
        columns = ("content",)
        like_or = " OR ".join(f"c.{col} LIKE ? ESCAPE '\\'" for col in columns for _ in words)
        word_params = [f"%{_escape_like(word)}%" for _ in columns for word in words]
        keyword_ids = [
            str(r["id"]) for r in await backend.store.fetch_all(
                f"SELECT c.id AS id FROM rag_chunks c "
                f"JOIN rag_documents d ON d.id = c.document_id "
                f"JOIN rag_sources s ON s.id = d.source_id "
                f"WHERE c.user_id = ? AND {_ACTIVE_SOURCE} AND ({like_or}) "
                f"LIMIT ?",
                [user_id, *word_params, RAG_CANDIDATES],
            )
        ]

    fused = rrf_fuse(
        [("vector", list(vec_by_id)), ("keyword", keyword_ids)],
        RAG_RRF_K,
    )
    top = sorted(fused, key=lambda cid: fused[cid]["score"], reverse=True)
    if not top:
        return []
    placeholders = ", ".join("?" for _ in top)
    rows = await backend.store.fetch_all(
        "SELECT c.id AS chunkId, c.content AS content, d.id AS documentId, "
        "s.id AS sourceId, s.name AS sourceName, d.title AS title "
        "FROM rag_chunks c "
        "JOIN rag_documents d ON d.id = c.document_id "
        "JOIN rag_sources s ON s.id = d.source_id "
        f"WHERE c.user_id = ? AND c.id IN ({placeholders}) AND {_ACTIVE_SOURCE}",
        [user_id, *top],
    )
    by_id = {str(r["chunkId"]): r for r in rows}

    with_vectors = [cid for cid in top if cid in vec_by_id and cid in by_id]
    without_vectors = [cid for cid in top if cid not in vec_by_id and cid in by_id]
    candidates = [
        RerankCandidate(
            chunk_id=cid,
            content=str(by_id[cid]["content"]),
            embedding=[float(v) for v in (vec_by_id[cid].get("values") or [])],
        )
        for cid in with_vectors
        if isinstance(vec_by_id[cid].get("values"), list)
    ]
    if os.environ.get("RAG_RERANK_LLM") == "true":
        reranked = await llm_rerank(query, candidates, limit)
        if reranked is None:
            reranked = mmr_rerank(query_vec, candidates, limit, RAG_MMR_LAMBDA)
    else:
        reranked = mmr_rerank(query_vec, candidates, limit, RAG_MMR_LAMBDA)
    ordered_ids = [c.chunk_id for c in reranked] + without_vectors[: max(0, limit - len(reranked))]

    snippets: list[dict[str, Any]] = []
    used = 0
    for chunk_id in ordered_ids[:limit]:
        row = by_id.get(chunk_id)
        if row is None:
            continue
        content = str(row["content"])
        if used + len(content) > max_chars:
            break
        snippets.append({
            "chunkId": chunk_id,
            "documentId": row["documentId"],
            "sourceId": row["sourceId"],
            "sourceName": row["sourceName"],
            "title": row["title"],
            "content": content,
            "score": fused[chunk_id]["score"],
            "marker": len(snippets) + 1,
        })
        used += len(content)

    await backend.store.atomic([
        backend.store.insert("rag_retrieval_logs", {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "query_hash": _hash(query),
            "matched_chunk_ids": [str(s["chunkId"]) for s in snippets],
            "created_at": utcnow_iso(),
        })
    ])
    return snippets
