"""Port of apps/backend/src/services/memory/search.test.ts (knobs + recall CTE rendering)."""

from yomi.services.memory.search import (
    AGENT_META_COLUMNS,
    FULL_META_COLUMNS,
    build_recall_cte,
    memory_search_knobs,
    search_memory_entries,
)


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return [dict(row) for row in self._rows]


class FakeSession:
    def __init__(self, rows=None, fail=False):
        self._rows = rows or []
        self.fail = fail
        self.statements = []

    async def execute(self, stmt, params=None):
        self.statements.append((stmt, params or {}))
        if self.fail:
            raise RuntimeError("query failed")
        return FakeResult(self._rows)


def _cte(query_embedding=None, meta_columns=("topic", "content")):
    return build_recall_cte(
        user_id="u1",
        query="vim",
        query_embedding=query_embedding or [],
        candidates=77,
        rrf_k=12,
        fused_limit=8,
        meta_columns=meta_columns,
    )


def test_memory_search_knobs_defaults(monkeypatch):
    monkeypatch.delenv("MEMORY_CANDIDATES", raising=False)
    monkeypatch.delenv("MEMORY_RRF_K", raising=False)
    assert memory_search_knobs() == {"candidates": 30, "rrf_k": 60}


def test_memory_search_knobs_honours_env(monkeypatch):
    monkeypatch.setenv("MEMORY_CANDIDATES", "77")
    monkeypatch.setenv("MEMORY_RRF_K", "12")
    assert memory_search_knobs() == {"candidates": 77, "rrf_k": 12}


def test_memory_search_knobs_clamps_candidates_floor(monkeypatch):
    monkeypatch.setenv("MEMORY_CANDIDATES", "2")
    assert memory_search_knobs()["candidates"] == 5


def test_memory_search_knobs_clamps_rrf_floor(monkeypatch):
    monkeypatch.setenv("MEMORY_RRF_K", "-4")
    assert memory_search_knobs()["rrf_k"] == 1


def test_memory_search_knobs_falls_back_for_non_numbers(monkeypatch):
    monkeypatch.setenv("MEMORY_CANDIDATES", "not-a-number")
    monkeypatch.setenv("MEMORY_RRF_K", "not-a-number")
    assert memory_search_knobs() == {"candidates": 30, "rrf_k": 60}


def test_recall_cte_candidate_count_in_every_arm_without_embedding():
    sql = _cte(query_embedding=[])
    assert sql.count("limit :candidates") == 2
    assert "null::uuid as memory_id" in sql
    assert "memory_embeddings" not in sql


def test_recall_cte_candidate_count_in_vector_arm_with_embedding():
    sql = _cte(query_embedding=[0.1, 0.2])
    assert sql.count("limit :candidates") == 3
    assert "from memory_embeddings me" in sql


def test_recall_cte_emits_fused_limit_once():
    sql = _cte()
    assert sql.count("limit :fused_limit") == 1


def test_recall_cte_carries_binds():
    sql = _cte()
    assert sql.count(":user_id") >= 2
    assert "websearch_to_tsquery('english', :query)" in sql


def test_recall_cte_spreads_meta_columns_into_ilike_scan():
    sql = build_recall_cte(
        user_id="u1",
        query="vim",
        query_embedding=[],
        candidates=77,
        rrf_k=12,
        fused_limit=8,
        meta_columns=("topic", "content", "kind"),
    )
    assert "e.topic ilike :query or e.content ilike :query or e.kind ilike :query" in sql


def test_meta_column_constants_match_ts():
    assert AGENT_META_COLUMNS == ("topic", "content", "kind", "scope")
    assert FULL_META_COLUMNS == ("topic", "summary", "content", "kind", "scope", "source_path")


async def test_search_memory_entries_blank_query_no_execute():
    session = FakeSession()
    rows = await search_memory_entries(session, "u1", "   ", 5)
    assert rows == []
    assert session.statements == []


async def test_search_memory_entries_db_error_is_empty():
    session = FakeSession(fail=True)
    assert await search_memory_entries(session, "u1", "vim rescue", 5) == []


async def test_search_memory_entries_returns_projection(monkeypatch):
    monkeypatch.setenv("MEMORY_CANDIDATES", "30")
    monkeypatch.setenv("MEMORY_RRF_K", "60")
    session = FakeSession(
        rows=[
            {
                "kind": "fact",
                "topic": "vim",
                "content": "leader is comma",
                "sourcePath": None,
                "isStatic": False,
                "updatedAt": "2026-01-01T00:00:00Z",
                "score": 0.5,
                "matchedBy": ["metadata"],
            }
        ]
    )
    rows = await search_memory_entries(session, "u1", "vim", 5)

    assert rows[0]["kind"] == "fact"
    assert rows[0]["matchedBy"] == ["metadata"]
    stmt, params = session.statements[0]
    assert ":candidates" in stmt.text
    assert params["user_id"] == "u1"
    assert params["candidates"] == 30
    assert "join memory_entries e on e.id = f.memory_id" in stmt.text