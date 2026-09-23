"""Port of apps/api/src/services/memory/consolidation.test.ts."""

from datetime import UTC, datetime

import pytest

from yomi.services.memory import consolidation


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return [dict(row) for row in self._rows]


class FakeSession:
    def __init__(self, rows=None, fail_after=None):
        self._rows = rows or []
        self.fail_after = fail_after
        self.statements = []
        self.added = []
        self._executes = 0

    async def execute(self, stmt, params=None):
        self._executes += 1
        if self.fail_after is not None and self._executes == self.fail_after:
            raise RuntimeError("query failed")
        self.statements.append((stmt, params or {}))
        return FakeResult(self._rows)

    def add(self, obj):
        self.added.append(obj)


def _pair(over=None):
    base = {
        "userId": "u1",
        "aId": "m1",
        "aCreatedAt": datetime(2026, 7, 1, tzinfo=UTC),
        "bId": "m2",
        "bCreatedAt": datetime(2026, 8, 1, tzinfo=UTC),
    }
    if over:
        base.update(over)
    return base


def test_max_distance_default(monkeypatch):
    monkeypatch.delenv("MEMORY_CONSOLIDATION_MAX_DISTANCE", raising=False)
    assert consolidation.max_distance() == pytest.approx(0.03)


def test_max_distance_honours_env(monkeypatch):
    monkeypatch.setenv("MEMORY_CONSOLIDATION_MAX_DISTANCE", "0.1")
    assert consolidation.max_distance() == pytest.approx(0.1)


def test_max_distance_capped_at_ceiling(monkeypatch):
    monkeypatch.setenv("MEMORY_CONSOLIDATION_MAX_DISTANCE", "0.9")
    assert consolidation.max_distance() == pytest.approx(0.25)


def test_max_distance_ignores_non_numeric(monkeypatch):
    monkeypatch.setenv("MEMORY_CONSOLIDATION_MAX_DISTANCE", "not-a-number")
    assert consolidation.max_distance() == pytest.approx(0.03)


def test_max_distance_ignores_non_positive(monkeypatch):
    monkeypatch.setenv("MEMORY_CONSOLIDATION_MAX_DISTANCE", "-1")
    assert consolidation.max_distance() == pytest.approx(0.03)


async def test_find_duplicate_pairs_returns_rows():
    session = FakeSession(rows=[_pair()])
    pairs = await consolidation.find_duplicate_pairs(session, 25)
    assert pairs == [
        {
            "userId": "u1",
            "aId": "m1",
            "bId": "m2",
            "aCreatedAt": datetime(2026, 7, 1, tzinfo=UTC),
            "bCreatedAt": datetime(2026, 8, 1, tzinfo=UTC),
        }
    ]


async def test_find_duplicate_pairs_restricts_both_sides():
    session = FakeSession()
    await consolidation.find_duplicate_pairs(session, 25)
    sql = session.statements[0][0].text
    assert "a.status = 'active'" in sql
    assert "b.status = 'active'" in sql
    assert "a.is_latest = true" in sql
    assert "b.is_latest = true" in sql
    assert "b.kind = a.kind" in sql


async def test_find_duplicate_pairs_passes_distance_and_batch(monkeypatch):
    monkeypatch.setenv("MEMORY_CONSOLIDATION_MAX_DISTANCE", "0.1")
    session = FakeSession()
    await consolidation.find_duplicate_pairs(session, 10)
    params = session.statements[0][1]
    assert params["distance"] == pytest.approx(0.1)
    assert params["batch_size"] == 10


async def test_find_duplicate_pairs_default_distance(monkeypatch):
    monkeypatch.delenv("MEMORY_CONSOLIDATION_MAX_DISTANCE", raising=False)
    session = FakeSession()
    await consolidation.find_duplicate_pairs(session, 25)
    assert session.statements[0][1]["distance"] == pytest.approx(0.03)


async def test_find_duplicate_pairs_query_failure_returns_empty():
    session = FakeSession(fail_after=1)
    assert await consolidation.find_duplicate_pairs(session, 25) == []


async def test_find_duplicate_pairs_drops_rows_missing_id():
    session = FakeSession(rows=[_pair(), {**_pair(), "aId": None}])
    pairs = await consolidation.find_duplicate_pairs(session, 25)
    assert len(pairs) == 1
    assert pairs[0]["aId"] == "m1"


def test_pick_survivor_keeps_later_created_at():
    assert consolidation.pick_survivor(_pair()) == {
        "survivor_id": "m2",
        "retired_id": "m1",
    }


def test_pick_survivor_breaks_tie_on_id():
    tie = datetime(2026, 7, 1, tzinfo=UTC)
    assert consolidation.pick_survivor(_pair({"aCreatedAt": tie, "bCreatedAt": tie})) == {
        "survivor_id": "m2",
        "retired_id": "m1",
    }
    assert consolidation.pick_survivor(
        _pair({"aId": "m9", "aCreatedAt": tie, "bCreatedAt": tie})
    ) == {"survivor_id": "m9", "retired_id": "m2"}


async def test_merge_pair_retires_older_row_as_merged():
    session = FakeSession()
    await consolidation.merge_pair(session, _pair())
    compiled = session.statements[0][0].compile()
    assert "UPDATE memory_entries" in str(compiled)
    values = list(compiled.params.values())
    assert any(v == "m1" for v in values)
    assert "active" in values
    assert "merged" in values
    assert False in values
    assert None in values
    assert any(isinstance(v, datetime) for v in values)


async def test_merge_pair_records_merges_relation_from_survivor():
    session = FakeSession()
    await consolidation.merge_pair(session, _pair())
    assert len(session.added) == 1
    relation = session.added[0]
    assert relation.__tablename__ == "memory_relations"
    assert relation.user_id == "u1"
    assert relation.from_memory_id == "m2"
    assert relation.to_memory_id == "m1"
    assert relation.relation_type == "merges"


async def test_sweep_merges_every_pair_and_counts():
    session = FakeSession(rows=[_pair(), _pair({"aId": "m3", "bId": "m4"})])
    assert await consolidation.sweep_memory_consolidation(session, 25) == 2
    assert len(session.added) == 2


async def test_sweep_continues_past_a_failing_pair():
    session = FakeSession(
        rows=[
            _pair(),
            _pair(
                {
                    "aId": "m3",
                    "bId": "m4",
                    "aCreatedAt": datetime(2026, 9, 1, tzinfo=UTC),
                }
            ),
        ],
        fail_after=2,
    )
    assert await consolidation.sweep_memory_consolidation(session, 25) == 1


async def test_sweep_zero_when_detection_fails():
    session = FakeSession(fail_after=1)
    assert await consolidation.sweep_memory_consolidation(session, 25) == 0


async def test_sweep_defaults_batch_size_to_25():
    session = FakeSession()
    await consolidation.sweep_memory_consolidation(session)
    assert session.statements[0][1]["batch_size"] == 25