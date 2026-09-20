"""Memory embeddings — best-effort call into the configured OpenAI endpoint.

Port of apps/backend/src/services/memory/embeddings.ts.
"""

from __future__ import annotations

import httpx

from yomi.conf import settings

MEMORY_EMBEDDING_DIMENSIONS = 1536
DEFAULT_MEMORY_EMBEDDING_MODEL = "text-embedding-3-small"

_embedding_timeout = httpx.Timeout(60.0)


def memory_embedding_model() -> str:
    return settings.openai_embedding_model or DEFAULT_MEMORY_EMBEDDING_MODEL


# Best-effort: every failure degrades to [] so recall falls back to full-text/metadata ranking.
async def embed_memory_text(input_text: str) -> list[float]:
    if not input_text.strip():
        return []
    api_key = settings.openai_api_key
    if not api_key:
        return []
    base_url = settings.openai_base_url.rstrip("/")

    async with httpx.AsyncClient(timeout=_embedding_timeout) as client:
        res = await client.post(
            f"{base_url}/embeddings",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": memory_embedding_model(), "input": input_text},
        )
    if res.status_code != 200:
        return []
    body = res.json()
    embedding = body.get("data", [{}])[0].get("embedding")
    if not isinstance(embedding, list) or len(embedding) != MEMORY_EMBEDDING_DIMENSIONS:
        return []
    return [float(v) for v in embedding]


def memory_vector_literal(values: list[float]) -> str:
    parts = [f"{v:.8f}" if v == v and abs(v) != float("inf") else "0" for v in values]
    return "[" + ",".join(parts) + "]"