"""Text chunking + OpenAI embeddings for Cloud RAG.

Port of apps/backend/src/services/rag/embeddings.ts.
"""

from __future__ import annotations

import httpx

from yomi.conf import settings
from yomi.shared.chunk import ChunkOptions, chunk_markdown

EMBEDDING_DIMENSIONS = 1536
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
CHUNK_CHARS = 1800
CHUNK_OVERLAP = 220

_embedding_timeout = httpx.Timeout(60.0)


def chunk_text(content: str) -> list[str]:
    return chunk_markdown(content, ChunkOptions(target_chars=CHUNK_CHARS, overlap=CHUNK_OVERLAP))


async def embed_text(input_text: str) -> list[float]:
    if not input_text.strip():
        return []
    api_key = settings.openai_api_key
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required for Cloud RAG embeddings")
    base_url = settings.openai_base_url.rstrip("/")
    model = settings.openai_embedding_model or DEFAULT_EMBEDDING_MODEL

    async with httpx.AsyncClient(timeout=_embedding_timeout) as client:
        res = await client.post(
            f"{base_url}/embeddings",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": model, "input": input_text},
        )
    if res.status_code != 200:
        raise RuntimeError(f"OpenAI embeddings failed: {res.status_code}")
    body = res.json()
    embedding = body.get("data", [{}])[0].get("embedding")
    if not isinstance(embedding, list) or len(embedding) != EMBEDDING_DIMENSIONS:
        raise RuntimeError(f"OpenAI embedding dimensions must be {EMBEDDING_DIMENSIONS}")
    return [float(v) for v in embedding]