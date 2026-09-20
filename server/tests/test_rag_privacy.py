"""Tests for rag/privacy pure logic — ports of lib/rerank.ts and friends."""

from __future__ import annotations

from yomi.lib.rerank import RerankCandidate, llm_rerank, mmr_rerank, parse_vector
from yomi.services.privacy.preferences import memo_privacy_read
from yomi.services.rag.index_document import content_hash_for, sanitize_text


class TestParseVector:
    def test_string_literal(self) -> None:
        assert parse_vector("[0.1, 0.2, 0.3]") == [0.1, 0.2, 0.3]

    def test_trailing_bracket_stripped_once(self) -> None:
        assert parse_vector("[1,2,3]") == [1.0, 2.0, 3.0]

    def test_list_passthrough(self) -> None:
        assert parse_vector([1.0, 2.0]) == [1.0, 2.0]

    def test_empty_and_garbage(self) -> None:
        assert parse_vector(None) == []
        assert parse_vector("[]") == []
        assert parse_vector("not-a-vector") == []

    def test_filters_non_finite(self) -> None:
        assert parse_vector("[NaN, 1, Infinity, 2]") == [1.0, 2.0]


class TestRerank:
    def _candidates(self) -> list[RerankCandidate]:
        return [
            RerankCandidate("a", "apple", [1.0, 0.0]),
            RerankCandidate("b", "banana", [0.9, 0.1]),
            RerankCandidate("c", "cherry", [0.0, 1.0]),
        ]

    def test_single_candidate_scoped_to_k(self) -> None:
        out = mmr_rerank([1.0, 0.0], self._candidates()[:1], 3)
        assert [c.chunk_id for c in out] == ["a"]

    def test_trivially_picks_most_relevant(self) -> None:
        out = mmr_rerank([1.0, 0.0], self._candidates(), 1)
        assert out[0].chunk_id == "a"

    def test_drops_near_duplicates_when_diversity_weighted(self) -> None:
        query = [1.0, 0.0]
        candidates = [
            RerankCandidate("a", "same", [1.0, 0.0]),
            RerankCandidate("b", "identical", [1.0, 0.0]),
            RerankCandidate("c", "distinct", [0.5, 0.5]),
        ]
        out = mmr_rerank(query, candidates, 2, lambda_=0.45)
        assert [c.chunk_id for c in out] == ["a", "c"]

    def test_empty_query_takes_prefix(self) -> None:
        out = mmr_rerank([], self._candidates(), 2)
        assert len(out) == 2

    async def test_llm_rerank_disabled(self) -> None:
        assert await llm_rerank("q", self._candidates(), 2) is None

    async def test_llm_rerank_trivial_prefix(self) -> None:
        out = await llm_rerank("q", self._candidates()[:1], 3)
        assert out is not None and [c.chunk_id for c in out] == ["a"]


class TestSanitizeText:
    def test_redacts_image_and_base64(self) -> None:
        text = "see data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAO+2gb\n"
        cleaned = sanitize_text(text)
        assert "[redacted image]" in cleaned
        assert "iVBOR" not in cleaned

    def test_collapses_newlines_and_strips_cr(self) -> None:
        assert sanitize_text("a\r\n\r\n\r\nb") == "a\n\nb"

    def test_content_hash_stable(self) -> None:
        assert content_hash_for("doc-1", "hello") == content_hash_for("doc-1", "hello")
        assert content_hash_for("doc-1", "hello") != content_hash_for("doc-1", "hello2")


class TestMemoPrivacyRead:
    async def test_caches_within_ttl(self) -> None:
        calls = 0

        async def load() -> int:
            nonlocal calls
            calls += 1
            return calls

        assert await memo_privacy_read("k1", load) == 1
        assert await memo_privacy_read("k1", load) == 1
        assert calls == 1