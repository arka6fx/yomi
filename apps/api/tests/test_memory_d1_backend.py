"""Behavioral tests for the D1 memory backend over an in-memory D1 fake."""

from __future__ import annotations

import re
from typing import Any

from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.store import D1Store
from yomi.services.memory import d1_backend
from yomi.services.memory.d1_backend import keyword_pattern, rrf_fuse


class FakeD1(D1Store):
    """Minimal D1: equality/LIKE/IN filters, multi-key ORDER BY, LIMIT,
    INSERT, status-flip UPDATEs, and UPDATE/DELETE ... RETURNING id."""

    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {
            "memory_entries": [],
            "memory_relations": [],
            "memory_sources": [],
            "vector_sync_outbox": [],
        }
        self.vectors: dict[str, list[str]] = {}

    def _insert(self, stmt: Statement) -> dict:
        match = re.match(r'INSERT (?:OR \w+ )?INTO "(\w+)" \((.+)\) VALUES', stmt.sql)
        assert match, stmt.sql
        cols = [c.strip().strip('"') for c in match.group(2).split(",")]
        self.tables[match.group(1)].append(dict(zip(cols, stmt.params, strict=True)))
        return {"success": True}

    def _split_top_level(self, where: str, sep: str) -> list[str]:
        parts, depth, current = [], 0, ""
        for token in where.split(f" {sep} "):
            depth += token.count("(") - token.count(")")
            current = f"{current} {sep} {token}".strip() if current else token
            if depth <= 0:
                parts.append(current)
                current = ""
        if current:
            parts.append(current)
        return [p for p in parts if p.strip()]

    def _eval(self, row: dict, cond: str, params: list, pos: int) -> tuple[bool, int]:
        cond = cond.strip()
        if cond.startswith("(") and cond.endswith(")"):
            width = cond.count("?")
            offset = pos
            for alt in self._split_top_level(cond[1:-1], "OR"):
                match, _ = self._eval(row, alt, params, offset)
                if match:
                    return True, pos + width
                offset += alt.count("?")
            return False, pos + width
        return self._match(row, cond, params, pos)

    def _match(self, row: dict, cond: str, params: list, pos: int) -> tuple[bool, int]:
        cond = cond.strip()
        if cond in ("1 = 1",):
            return True, pos
        if m := re.match(r"(\w+) = '([^']*)'$", cond):
            return str(row.get(m.group(1))) == m.group(2), pos
        if m := re.match(r"(\w+) = (\d+)$", cond):
            return int(row.get(m.group(1)) or 0) == int(m.group(2)), pos
        if m := re.match(r"(\w+) = \?$", cond):
            value = params[pos]
            return row.get(m.group(1)) == value, pos + 1
        if m := re.match(r"(\w+) = \? COLLATE NOCASE$", cond):
            value = str(params[pos]).lower()
            return str(row.get(m.group(1)) or "").lower() == value, pos + 1
        if m := re.match(r"(\w+) LIKE \? ESCAPE", cond):
            pattern = str(params[pos]).strip("%").lower()
            return pattern in str(row.get(m.group(1)) or "").lower(), pos + 1
        if m := re.match(r"(\w+) IS NOT NULL$", cond):
            return row.get(m.group(1)) is not None, pos
        if m := re.match(r"(\w+) < \?$", cond):
            left, right = row.get(m.group(1)), params[pos]
            return (left is not None and str(left) < str(right)), pos + 1
        if m := re.match(r"(\w+) IN \(([\?, ]+)\)$", cond):
            count = m.group(2).count("?")
            return row.get(m.group(1)) in params[pos : pos + count], pos + count
        raise AssertionError(f"unsupported cond: {cond}")

    def _select(self, sql: str, params: list) -> list[dict]:
        table = re.search(r'FROM (\w+)', sql).group(1)  # type: ignore[union-attr]
        rows = list(self.tables[table])
        if "WHERE" in sql:
            where = sql.split("WHERE", 1)[1].split("ORDER BY")[0].split("LIMIT")[0]
            conds = self._split_top_level(where, "AND")
            kept = []
            for row in rows:
                pos, ok = 0, True
                for cond in conds:
                    match, pos = self._eval(row, cond, params, pos)
                    if not match:
                        ok = False
                        break
                if ok:
                    kept.append(row)
            rows = kept
        if "ORDER BY" in sql:
            order = sql.split("ORDER BY", 1)[1].split("LIMIT")[0]
            keys = []
            for part in order.split(","):
                part = part.strip()
                col, _, direction = part.partition(" ")
                keys.append((col.strip('"'), direction.strip().upper() == "DESC"))
            for col, desc in reversed(keys):
                rows.sort(
                    key=lambda r, c=col: (r.get(c) is None, str(r.get(c) or "")),
                    reverse=desc,
                )
        if "LIMIT ?" in sql:
            rows = rows[: int(params[-1])]
        elif m := re.search(r"LIMIT (\d+)", sql):
            rows = rows[: int(m.group(1))]
        if sql.strip().upper().startswith("SELECT ID FROM"):
            return [{"id": r["id"]} for r in rows]
        if sql.strip().upper().startswith("SELECT TO_MEMORY_ID"):
            return [
                {"to_memory_id": r["to_memory_id"], "relation_type": r["relation_type"]}
                for r in rows
            ]
        if sql.strip().upper().startswith("SELECT FROM_MEMORY_ID"):
            return [
                {"from_memory_id": r["from_memory_id"], "to_memory_id": r["to_memory_id"]}
                for r in rows
            ]
        if "COUNT(*)" in sql:
            return [{"n": len(rows)}]
        return rows

    def _update(self, stmt: Statement) -> dict:
        sql, params = stmt.sql, list(stmt.params)
        if "SET custom_id = NULL" in sql:
            for row in self.tables["memory_entries"]:
                if row["id"] == params[0]:
                    row["custom_id"] = None
            return {"success": True}
        if "SET status = 'superseded'" in sql:
            now, target = params
            for row in self.tables["memory_entries"]:
                if row["id"] == target:
                    row.update(status="superseded", is_latest=0, updated_at=now)
            return {"success": True}
        if "SET status = 'forgotten'" in sql:
            now, rest = params[0], params[1:]
            ids = self._select_ids(sql, rest)
            for row in self.tables["memory_entries"]:
                if row["id"] in ids:
                    row.update(status="forgotten", updated_at=now)
            return {"success": True, "results": [{"id": i} for i in ids]}
        if "SET attempts = attempts + 1" in sql:
            return {"success": True}
        if "SET processed_at" in sql:
            return {"success": True}
        raise AssertionError(f"unsupported update: {sql}")

    def _select_ids(self, sql: str, params: list) -> list[str]:
        table = "memory_entries"
        where = sql.split("WHERE", 1)[1].split("RETURNING")[0]
        return [r["id"] for r in self._select(f"SELECT * FROM {table} WHERE {where}", params)]

    async def atomic(self, statements: list[Statement]) -> list[dict]:
        out = []
        for stmt in statements:
            if stmt.sql.startswith("INSERT"):
                out.append(self._insert(stmt))
            elif stmt.sql.startswith("UPDATE"):
                out.append(self._update(stmt))
            elif stmt.sql.startswith("DELETE"):
                ids = self._select_ids(stmt.sql, list(stmt.params))
                self.tables["memory_entries"] = [
                    r for r in self.tables["memory_entries"] if r["id"] not in ids
                ]
                out.append({"success": True, "results": [{"id": i} for i in ids]})
            else:
                raise AssertionError(f"unsupported: {stmt.sql}")
        return out

    async def fetch_all(self, sql: str, params: list[Any] | None = None) -> list[dict]:
        return self._select(sql, list(params or []))

    async def fetch_one(self, sql: str, params: list[Any] | None = None) -> dict | None:
        rows = self._select(sql, list(params or []))
        return rows[0] if rows else None


class FakeClient:
    def __init__(self, matches: list[str] | None = None) -> None:
        self.matches = matches or []
        self.deleted: list[tuple[str, str]] = []
        self.upserted: list[tuple[str, str]] = []

    async def vector_query(self, user_id: str, kind: str, values: list, limit: int = 20):
        return [{"recordId": mid, "revision": "v1", "score": 0.9} for mid in self.matches]


class Backend:
    def __init__(self, fake: FakeD1, matches: list[str] | None = None) -> None:
        self.store = fake
        self.client = FakeClient(matches)


async def fake_embed(_text: str) -> list[float]:
    return [0.1, 0.2]


def base_input(**overrides: Any) -> dict[str, Any]:
    data: dict[str, Any] = {"topic": "editor", "content": "uses vim"}
    data.update(overrides)
    return data


class TestUpsert:
    async def test_creates_entry_and_vector_op(self) -> None:
        fake, backend = FakeD1(), None
        backend = Backend(fake)
        out = await d1_backend.upsert(backend, "u-1", base_input(), embed=fake_embed)
        assert out and out["topic"] == "editor" and out["isLatest"] is True
        assert len(fake.tables["memory_entries"]) == 1
        ops = fake.tables["vector_sync_outbox"]
        assert len(ops) == 1 and ops[0]["operation"] == "upsert"
        assert ops[0]["record_id"] == out["id"]

    async def test_same_topic_supersedes_with_edge_and_vector_delete(self) -> None:
        backend = Backend(FakeD1())
        first = await d1_backend.upsert(backend, "u-1", base_input(), embed=fake_embed)
        assert first
        second = await d1_backend.upsert(
            backend, "u-1", base_input(content="uses vscode"), embed=fake_embed
        )
        assert second and second["version"] == 2
        rows = {r["id"]: r for r in backend.store.tables["memory_entries"]}
        assert rows[first["id"]]["status"] == "superseded"
        assert rows[first["id"]]["is_latest"] == 0
        edges = backend.store.tables["memory_relations"]
        assert len(edges) == 1 and edges[0]["relation_type"] == "updates"
        deletes = [
            o for o in backend.store.tables["vector_sync_outbox"]
            if o["operation"] == "delete"
        ]
        assert [d["record_id"] for d in deletes] == [first["id"]]

    async def test_empty_content_returns_none(self) -> None:
        backend = Backend(FakeD1())
        assert await d1_backend.upsert(backend, "u-1", {"content": "  "}) is None

    async def test_embedding_failure_still_stores_memory(self) -> None:
        async def boom(_text: str) -> list[float]:
            raise RuntimeError("no key")

        backend = Backend(FakeD1())
        out = await d1_backend.upsert(backend, "u-1", base_input(), embed=boom)
        assert out is not None
        assert backend.store.tables["vector_sync_outbox"] == []


class TestSearch:
    async def test_fuses_vector_and_keyword_with_scores(self) -> None:
        fake = FakeD1()
        first = await d1_backend.upsert(fake and Backend(fake), "u-1", base_input())
        # second memory only matches by keyword
        await d1_backend.upsert(
            Backend(fake), "u-1", base_input(topic="editor tweaks", content="vim bindings")
        )
        assert first
        backend = Backend(fake, matches=[first["id"]])
        res = await d1_backend.search(backend, "u-1", "vim editor", 5, 4000, embed=fake_embed)
        assert [r["id"] for r in res][0] == first["id"]
        assert res[0]["matchedBy"] == ["vector", "full_text"]
        assert res[0]["score"] > res[1]["score"]
        assert res[1]["matchedBy"] == ["full_text"]

    async def test_empty_query_lists_recent(self) -> None:
        backend = Backend(FakeD1())
        await d1_backend.upsert(backend, "u-1", base_input())
        res = await d1_backend.search(backend, "u-1", "", 5, 4000)
        assert len(res) == 1

    async def test_respects_max_chars(self) -> None:
        backend = Backend(FakeD1())
        await d1_backend.upsert(backend, "u-1", base_input(content="x" * 100))
        res = await d1_backend.search(backend, "u-1", "vim", 5, 10, embed=fake_embed)
        assert res == []


class TestForgetPrune:
    async def test_soft_forget_enqueues_vector_delete(self) -> None:
        backend = Backend(FakeD1())
        out = await d1_backend.upsert(backend, "u-1", base_input(), embed=fake_embed)
        assert out
        res = await d1_backend.forget(backend, "u-1", item_id=str(out["id"]))
        assert res == {"forgotten": 1, "ids": [out["id"]]}
        deletes = [
            o for o in backend.store.tables["vector_sync_outbox"]
            if o["operation"] == "delete" and o["record_id"] == out["id"]
        ]
        assert deletes

    async def test_hard_delete_removes_row(self) -> None:
        backend = Backend(FakeD1())
        out = await d1_backend.upsert(backend, "u-1", base_input())
        assert out
        res = await d1_backend.forget(backend, "u-1", item_id=str(out["id"]), hard=True)
        assert res["deleted"] == 1
        assert backend.store.tables["memory_entries"] == []

    async def test_prune_expired(self) -> None:
        backend = Backend(FakeD1())
        out = await d1_backend.upsert(
            backend, "u-1", base_input(forgetAfter="2000-01-01T00:00:00Z")
        )
        assert out
        await d1_backend.prune_expired(backend, "u-1")
        rows = backend.store.tables["memory_entries"]
        assert rows[0]["status"] == "forgotten"


class TestPure:
    def test_rrf_orders_by_fused_score(self) -> None:
        fused = rrf_fuse([("a", ["x", "y"]), ("b", ["y"])], 60)
        assert fused["y"]["score"] > fused["x"]["score"]
        assert fused["y"]["matchedBy"] == ["a", "b"]

    def test_keyword_pattern_respects_byte_budget(self) -> None:
        long_query = " ".join([f"word{i}" for i in range(50)])
        assert len(keyword_pattern(long_query).encode()) <= d1_backend.LIKE_BUDGET_BYTES
