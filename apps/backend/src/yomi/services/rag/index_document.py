"""Document indexing for Cloud RAG.

Port of apps/backend/src/services/rag/index-document.ts.
"""

from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import and_, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.conf import settings
from yomi.db.models_app import RagChunk, RagDocument, RagEmbedding

from .embeddings import DEFAULT_EMBEDDING_MODEL, chunk_text, embed_text

MAX_TEXT_CHARS = 120_000


@dataclass
class IndexDocumentInput:
    user_id: str
    source_id: str
    external_id: str
    title: str
    mime_type: str
    text: str
    metadata_: dict[str, Any] | None = field(default=None)


def content_hash_for(external_id: str, text: str) -> str:
    return hashlib.sha256(f"{external_id}\0{text}".encode()).hexdigest()


_REDACT_IMAGE = re.compile(r"data:image/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+")
_REDACT_BASE64 = re.compile(r"[A-Za-z0-9+/=]{400,}")
_COLLAPSE_NEWLINES = re.compile(r"\n{3,}")


def sanitize_text(value: str) -> str:
    # Mirrors the sanitation the manual push path applies in routes/rag.ts:
    # strips CRs, redacts inline images and long base64 runs, collapses blank
    # lines, and caps size so a huge Drive export can't produce unbounded
    # chunks/embeddings. Applied before hashing so the unchanged-check sees the
    # stored text.
    text = _REDACT_IMAGE.sub("[redacted image]", value.replace("\r", ""))
    text = _REDACT_BASE64.sub("[redacted base64]", text)
    text = _COLLAPSE_NEWLINES.sub("\n\n", text)
    return text[:MAX_TEXT_CHARS].strip()


async def index_document(
    session: AsyncSession,
    input_: IndexDocumentInput,
) -> dict[str, Any]:
    """Returns {status: "indexed"|"unchanged", documentId: str | None}."""
    text = sanitize_text(input_.text)
    content_hash = content_hash_for(input_.external_id, text)

    existing = (
        await session.execute(
            select(RagDocument.id, RagDocument.content_hash).where(
                and_(
                    RagDocument.source_id == input_.source_id,
                    RagDocument.external_id == input_.external_id,
                )
            )
        )
    ).first()

    if existing is not None and existing.content_hash == content_hash:
        return {"status": "unchanged", "documentId": str(existing.id)}
    if existing is not None:
        # Content changed — drop the old document; chunks/embeddings cascade.
        await session.execute(delete(RagDocument).where(RagDocument.id == existing.id))

    document = RagDocument(
        user_id=input_.user_id,
        source_id=input_.source_id,
        title=input_.title,
        mime_type=input_.mime_type,
        content_hash=content_hash,
        external_id=input_.external_id,
        metadata_=input_.metadata_,
    )
    session.add(document)
    await session.flush()

    model = settings.workers_ai_embedding_model or DEFAULT_EMBEDDING_MODEL
    for chunk_index, chunk in enumerate(chunk_text(text)):
        created_chunk = RagChunk(
            user_id=input_.user_id,
            document_id=document.id,
            chunk_index=chunk_index,
            content=chunk,
            token_count=math.ceil(len(chunk) / 4),
            metadata_=input_.metadata_,
        )
        session.add(created_chunk)
        await session.flush()
        embedding = await embed_text(chunk)
        session.add(
            RagEmbedding(
                user_id=input_.user_id,
                chunk_id=created_chunk.id,
                model=model,
                embedding=embedding,
            )
        )
    await session.flush()

    return {"status": "indexed", "documentId": str(document.id)}


async def delete_document_by_external_id(
    session: AsyncSession, user_id: str, source_id: str, external_id: str
) -> bool:
    existing = (
        await session.execute(
            select(RagDocument.id).where(
                and_(
                    RagDocument.source_id == source_id,
                    RagDocument.external_id == external_id,
                )
            )
        )
    ).first()
    if existing is None:
        return False
    await session.execute(delete(RagDocument).where(RagDocument.id == existing.id))
    return True