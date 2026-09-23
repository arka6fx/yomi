"""Reranking for hybrid RAG retrieval.

Port of apps/api/src/lib/rerank.ts.
- mmr_rerank: cheap, embedding-based Maximal Marginal Relevance (no network). Always on.
- llm_rerank: optional listwise rerank, disabled until an OpenAI rerank path is
  configured, with a strict timeout; returns None on failure so the caller falls
  back to MMR order.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class RerankCandidate:
    chunk_id: str
    content: str
    embedding: list[float]


def _dot(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    total = 0.0
    for i in range(n):
        total += a[i] * b[i]
    return total


def _cosine(a: list[float], b: list[float]) -> float:
    denom = math.sqrt(_dot(a, a)) * math.sqrt(_dot(b, b))
    return _dot(a, b) / denom if denom else 0.0


# Parse a pgvector text literal "[0.1,0.2,...]" into list[float].
def parse_vector(value: object) -> list[float]:
    if isinstance(value, list):
        return [v for v in value if isinstance(v, (int, float))]
    if not isinstance(value, str):
        return []
    inner = value.strip()
    if inner.startswith("["):
        inner = inner[1:]
    if inner.endswith("]"):
        inner = inner[:-1]
    inner = inner.strip()
    if not inner:
        return []
    out: list[float] = []
    for part in inner.split(","):
        try:
            num = float(part.strip())
        except ValueError:
            continue
        if math.isfinite(num):
            out.append(num)
    return out


# Maximal Marginal Relevance: trade off query relevance against novelty vs
# already-picked chunks. Also drops near-duplicate chunks that pure distance
# ordering would surface together.
def mmr_rerank(
    query_embedding: list[float],
    candidates: list[RerankCandidate],
    k: int,
    lambda_: float = 0.7,
) -> list[RerankCandidate]:
    if len(candidates) <= 1 or not query_embedding:
        return candidates[:k]
    relevance: dict[str, float] = {
        c.chunk_id: _cosine(query_embedding, c.embedding) if c.embedding else 0.0
        for c in candidates
    }

    selected: list[RerankCandidate] = []
    remaining = list(candidates)
    while len(selected) < k and remaining:
        best_idx = 0
        best_score = -math.inf
        for i, c in enumerate(remaining):
            rel = relevance.get(c.chunk_id) or 0.0
            max_sim = 0.0
            for s in selected:
                if not c.embedding or not s.embedding:
                    continue
                max_sim = max(max_sim, _cosine(c.embedding, s.embedding))
            score = lambda_ * rel - (1 - lambda_) * max_sim
            if score > best_score:
                best_score = score
                best_idx = i
        selected.append(remaining.pop(best_idx))
    return selected


# Optional listwise LLM rerank. Disabled until production enables reranking.
async def llm_rerank(
    _query: str,
    candidates: list[RerankCandidate],
    k: int,
) -> list[RerankCandidate] | None:
    if len(candidates) <= 1 or k <= 0:
        return candidates[:k]
    return None