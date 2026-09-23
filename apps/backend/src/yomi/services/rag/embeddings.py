"""Text chunking + Workers AI embeddings for Cloud RAG."""

from __future__ import annotations

import httpx

from yomi.conf import settings
from yomi.shared.chunk import ChunkOptions, chunk_markdown

EMBEDDING_DIMENSIONS = 768
DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5"
CHUNK_CHARS = 1800
CHUNK_OVERLAP = 220

_embedding_timeout = httpx.Timeout(60.0)


def chunk_text(content: str) -> list[str]:
    return chunk_markdown(content, ChunkOptions(target_chars=CHUNK_CHARS, overlap=CHUNK_OVERLAP))


def _workers_ai_target() -> tuple[str, str]:
    account = (settings.cloudflare_account_id or "").strip()
    token = (settings.cloudflare_api_token or "").strip()
    model = settings.workers_ai_embedding_model or DEFAULT_EMBEDDING_MODEL
    if not account or not token:
        raise RuntimeError(
            "Workers AI is not configured (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN)"
        )
    return (
        f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model}",
        token,
    )


async def embed_text(input_text: str) -> list[float]:
    if not input_text.strip():
        return []
    url, token = _workers_ai_target()

    async with httpx.AsyncClient(timeout=_embedding_timeout) as client:
        res = await client.post(
            url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"text": input_text},
        )
    if res.status_code != 200:
        raise RuntimeError(f"Workers AI embeddings failed: {res.status_code}")
    data = res.json().get("result", {}).get("data", [[]])[0]
    if not isinstance(data, list) or len(data) != EMBEDDING_DIMENSIONS:
        raise RuntimeError(f"Workers AI embedding dimensions must be {EMBEDDING_DIMENSIONS}")
    return [float(v) for v in data]