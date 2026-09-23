"""Memory embeddings via Cloudflare Workers AI.

Best-effort: every failure degrades to [] so recall falls back to
full-text/metadata ranking.
"""

from __future__ import annotations

import httpx

from yomi.conf import settings

MEMORY_EMBEDDING_DIMENSIONS = 768
DEFAULT_MEMORY_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5"

_embedding_timeout = httpx.Timeout(60.0)


def memory_embedding_model() -> str:
    return settings.workers_ai_embedding_model or DEFAULT_MEMORY_EMBEDDING_MODEL


def _workers_ai_target() -> tuple[str, str]:
    account = (settings.cloudflare_account_id or "").strip()
    token = (settings.cloudflare_api_token or "").strip()
    if not account or not token:
        raise RuntimeError("Workers AI is not configured")
    return (
        f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/"
        f"{memory_embedding_model()}",
        token,
    )


# Best-effort: every failure degrades to [] so recall falls back to full-text/metadata ranking.
async def embed_memory_text(input_text: str) -> list[float]:
    if not input_text.strip():
        return []
    try:
        url, token = _workers_ai_target()
    except RuntimeError:
        return []
    try:
        async with httpx.AsyncClient(timeout=_embedding_timeout) as client:
            res = await client.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"text": input_text},
            )
        if res.status_code != 200:
            return []
        data = res.json().get("result", {}).get("data", [[]])[0]
    except Exception:
        return []
    if not isinstance(data, list) or len(data) != MEMORY_EMBEDDING_DIMENSIONS:
        return []
    return [float(v) for v in data]


def memory_vector_literal(values: list[float]) -> str:
    parts = [f"{v:.8f}" if v == v and abs(v) != float("inf") else "0" for v in values]
    return "[" + ",".join(parts) + "]"