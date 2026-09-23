"""Memory recall — hybrid vector + full-text + metadata ranking.

Port of apps/api/src/services/memory/search.ts.
"""

from __future__ import annotations

import os
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.services.memory.embeddings import embed_memory_text, memory_vector_literal

# A closed union rather than free strings: these become bare identifiers in the ILIKE scan.
AGENT_META_COLUMNS = ("topic", "content", "kind", "scope")
FULL_META_COLUMNS = ("topic", "summary", "content", "kind", "scope", "source_path")


def _search_knob(env_key: str, fallback: int) -> int:
    raw = os.environ.get(env_key)
    if not raw:
        return fallback
    try:
        n = int(raw)
    except ValueError:
        return fallback
    return n if n else fallback


# Resolved per call, not at import time, so a deploy-time env change reaches every recall path.
def memory_search_knobs() -> dict[str, int]:
    return {
        "candidates": max(5, _search_knob("MEMORY_CANDIDATES", 30)),
        "rrf_k": max(1, _search_knob("MEMORY_RRF_K", 60)),
    }


def build_recall_cte(
    user_id: str,
    query: str,
    query_embedding: list[float],
    candidates: int,
    rrf_k: int,
    fused_limit: int,
    meta_columns: tuple[str, ...],
) -> str:
    """The `with ... fused` prefix shared by all recall paths; each caller
    appends its own projection and final limit. Placeholders use :name binds
    (user_id, query, candidates, rrf_k, fused_limit)."""
    vec_clause = (
        f"""
        vec as (
          select me.memory_id,
                 row_number() over (order by me.embedding <=>"""
        f""" '{memory_vector_literal(query_embedding)}'::vector) as rnk
          from memory_embeddings me
          where me.user_id = :user_id
          order by me.embedding <=> '{memory_vector_literal(query_embedding)}'::vector
          limit :candidates
        ),
        """
        if query_embedding
        else """
        vec as (
          select null::uuid as memory_id, null::bigint as rnk
          where false
        ),
        """
    )
    meta_match = " or ".join(f"e.{col} ilike :query" for col in meta_columns)

    return f"""
      with {vec_clause}
      fts as (
        select e.id as memory_id,
               row_number() over (order by ts_rank_cd(
                 e.content_tsv, websearch_to_tsquery('english', :query)) desc) as rnk
        from memory_entries e
        where e.user_id = :user_id
          and e.status = 'active'
          and e.is_latest = true
          and e.content_tsv @@ websearch_to_tsquery('english', :query)
        limit :candidates
      ),
      meta as (
        select e.id as memory_id,
               row_number() over (order by e.is_static desc, e.confidence desc,
                 e.updated_at desc) as rnk
        from memory_entries e
        where e.user_id = :user_id
          and e.status = 'active'
          and e.is_latest = true
          and ({meta_match})
        limit :candidates
      ),
      fused as (
        select memory_id,
               sum(1.0 / (:rrf_k + rnk)) as score,
               array_agg(source) as matched_by
        from (
          select memory_id, rnk, 'vector'::text as source from vec where memory_id is not null
          union all
          select memory_id, rnk, 'full_text'::text as source from fts
          union all
          select memory_id, rnk, 'metadata'::text as source from meta
        ) u
        group by memory_id
        order by score desc
        limit :fused_limit
      )
    """


_META_BINDS = ("user_id", "query", "candidates", "rrf_k", "fused_limit")


# Same hybrid vector+FTS+metadata query the agent path uses for passive
# injection, factored out so it can also back the actively-callable
# memory_search tool.
async def search_memory_entries(
    session: AsyncSession, user_id: str, query: str, limit: int
) -> list[dict[str, Any]]:
    try:
        safe = query.strip()[:400]
        if not safe:
            return []
        query_embedding = await embed_memory_text(safe)
        knobs = memory_search_knobs()
        prefix = build_recall_cte(
            user_id=user_id,
            query=safe,
            query_embedding=query_embedding,
            candidates=knobs["candidates"],
            rrf_k=knobs["rrf_k"],
            fused_limit=limit,
            meta_columns=AGENT_META_COLUMNS,
        )
        tail = f"""
        select
          e.kind as "kind",
          e.topic as "topic",
          e.content as "content",
          e.source_path as "sourcePath",
          e.is_static as "isStatic",
          e.updated_at as "updatedAt",
          f.score as "score",
          f.matched_by as "matchedBy"
        from fused f
        join memory_entries e on e.id = f.memory_id
        order by e.is_static desc, f.score desc, e.confidence desc, e.updated_at desc
        limit {limit}
        """
        stmt = text(prefix + "\n" + tail)
        result = await session.execute(
            stmt,
            {
                "user_id": user_id,
                "query": safe,
                "candidates": knobs["candidates"],
                "rrf_k": knobs["rrf_k"],
                "fused_limit": limit,
            },
        )
    except Exception:
        return []
    return [dict(row) for row in result.mappings()]