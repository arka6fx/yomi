"""Behavioral tests for the D1 privacy backend over an in-memory fake."""

from __future__ import annotations

import re
from typing import Any

from yomi.services import privacy_d1
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.store import D1Store


class FakePrivacy(D1Store):
    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {}
        for name in (
            "user", "session", "account", "agent_messages", "agent_sessions",
            "memory_entries", "memory_relations", "memory_sources", "rag_sources",
            "rag_documents", "rag_chunks", "rag_retrieval_logs", "mcp_connections",
            "platform_connections", "pending_actions", "vault_payments", "vault_items",
            "trust_messages", "trust_links", "trust_settings",
            "schedules", "suggestion_decisions",
            "usage_events", "linking_codes", "telegram_link_tokens", "privacy_consents",
            "privacy_preferences", "privacy_exports", "privacy_deletion_jobs",
            "privacy_audit_events", "vector_sync_outbox",
        ):
            self.tables[name] = []

    def _insert(self, stmt: Statement) -> dict:
        match = re.match(r'INSERT (?:OR \w+ )?INTO "(\w+)" \((.+)\) VALUES', stmt.sql)
        assert match, stmt.sql
        table = match.group(1)
        cols = [c.strip().strip('"') for c in match.group(2).split(",")]
        self.tables[table].append(dict(zip(cols, stmt.params, strict=True)))
        return {"success": True}

    def _match(self, row: dict, cond: str, params: list, pos: int) -> tuple[bool, int]:
        cond = cond.strip()
        if m := re.match(r"(\w+) = \?$", cond):
            return row.get(m.group(1)) == params[pos], pos + 1
        if m := re.match(r"(\w+) = '([^']*)'$", cond):
            return str(row.get(m.group(1))) == m.group(2), pos
        if m := re.match(r"(\w+) > \?$", cond):
            left, right = row.get(m.group(1)), params[pos]
            return (left is not None and str(left) > str(right)), pos + 1
        if m := re.match(r"(\w+) IN \(([\?, ]+)\)$", cond):
            count = m.group(2).count("?")
            return row.get(m.group(1)) in params[pos : pos + count], pos + count
        raise AssertionError(f"unsupported cond: {cond}")

    def _where(self, table: str, where: str, params: list) -> list[dict]:
        rows = []
        for row in self.tables[table]:
            pos, ok = 0, True
            for cond in [c for c in where.split(" AND ") if c.strip()]:
                match, pos = self._match(row, cond, params, pos)
                if not match:
                    ok = False
                    break
            if ok:
                rows.append(row)
        return rows

    def _apply_set(self, row: dict, assignments: str, params: list) -> None:
        pos = 0
        for part in assignments.split(","):
            part = part.strip()
            if m := re.match(r"(\w+) = \?$", part):
                row[m.group(1)] = params[pos]
                pos += 1
            elif m := re.match(r"(\w+) = '([^']*)'$", part):
                row[m.group(1)] = m.group(2)
            else:
                raise AssertionError(f"unsupported set: {part}")

    def _cascade(self, table: str, doomed_ids: set[str]) -> None:
        if table == "memory_entries":
            keep_sources = [
                r for r in self.tables["memory_sources"]
                if str(r["memory_id"]) not in doomed_ids
            ]
            self.tables["memory_sources"] = keep_sources
        if table == "rag_documents":
            keep_chunks = [
                r for r in self.tables["rag_chunks"]
                if str(r["document_id"]) not in doomed_ids
            ]
            self.tables["rag_chunks"] = keep_chunks

    async def atomic(self, statements: list[Statement]) -> list[dict]:
        out = []
        for stmt in statements:
            sql = stmt.sql
            if sql.startswith("INSERT"):
                out.append(self._insert(stmt))
            elif sql.startswith("DELETE FROM"):
                table = sql.split(" ")[2]
                where = sql.split("WHERE", 1)[1].split("RETURNING")[0]
                doomed = self._where(table, where, list(stmt.params))
                doomed_ids = {str(r.get("id")) for r in doomed}
                self._cascade(table, doomed_ids)
                doomed_keys = {id(r) for r in doomed}
                self.tables[table] = [r for r in self.tables[table] if id(r) not in doomed_keys]
                meta = {"changes": len(doomed)}
                if "RETURNING" in sql:
                    out.append({"success": True, "meta": meta,
                                "results": [{"id": r.get("id")} for r in doomed]})
                else:
                    out.append({"success": True, "meta": meta})
            elif sql.startswith("UPDATE"):
                set_part = sql.split("SET", 1)[1].split("WHERE")[0]
                where = sql.split("WHERE", 1)[1].split("RETURNING")[0]
                set_count = set_part.count("?")
                rows = self._where(
                    sql.split("UPDATE ", 1)[1].split(" ")[0], where,
                    list(stmt.params)[set_count:],
                )
                for row in rows:
                    self._apply_set(row, set_part, list(stmt.params))
                out.append({"success": True})
            else:
                raise AssertionError(f"unsupported: {sql}")
        return out

    async def fetch_all(self, sql: str, params: list[Any] | None = None) -> list[dict]:
        p = list(params or [])
        match = re.search(r"FROM (\w+)", sql)
        assert match, sql
        table = match.group(1)
        cols = sql.split("SELECT", 1)[1].split("FROM")[0].strip()
        if "WHERE" in sql:
            where = sql.split("WHERE", 1)[1].split("ORDER BY")[0].split("LIMIT")[0]
            rows = self._where(table, where, p)
        else:
            rows = list(self.tables[table])
        if "ORDER BY" in sql:
            order = sql.split("ORDER BY", 1)[1].split("LIMIT")[0].strip()
            col = order.split(" ")[0].split(".")[-1]
            rows = sorted(rows, key=lambda r: str(r.get(col) or ""),
                          reverse="DESC" in order)
        if "COUNT(*)" in cols:
            return [{"n": len(rows)}]
        if "LIMIT ?" in sql:
            rows = rows[: int(p[-1])]
        elif m := re.search(r"LIMIT (\d+)", sql):
            rows = rows[: int(m.group(1))]
        if cols == "*":
            return rows
        aliased: dict[str, str] = {}
        for c in cols.split(","):
            c = c.strip()
            parts = re.split(r"\s+[Aa][Ss]\s+", c)
            if len(parts) == 2:
                aliased[parts[1].strip()] = parts[0].strip().split(".")[-1]
            else:
                key = c.split(" ")[0].split(".")[-1]
                aliased[key] = key
        return [{alias: r.get(col) for alias, col in aliased.items()} for r in rows]

    async def fetch_one(self, sql: str, params: list[Any] | None = None) -> dict | None:
        rows = await self.fetch_all(sql, params)
        return rows[0] if rows else None


class Backend:
    def __init__(self) -> None:
        self.store = FakePrivacy()
        self.client = None


def seed_user(backend: Backend, user_id: str = "u-1") -> None:
    backend.store.tables["user"].append({"id": user_id, "email": f"{user_id}@x.test"})


class TestAudit:
    async def test_record_and_list_redacts(self) -> None:
        backend = Backend()
        await privacy_d1.record_privacy_audit_event(
            backend, actor_user_id="u-1", target_user_id="u-1",
            event_type="privacy.test", metadata={"ok": "yes", "email": "no@x.test"},
        )
        rows = await privacy_d1.list_privacy_activity(backend, "u-1", 10)
        assert len(rows) == 1 and rows[0]["eventType"] == "privacy.test"
        assert rows[0]["metadata"] == {"ok": "yes"}


class TestExport:
    async def test_request_get_list(self) -> None:
        backend = Backend()
        seed_user(backend)
        backend.store.tables["memory_entries"].append({
            "id": "m-1", "user_id": "u-1", "kind": "fact", "topic": "t",
            "summary": None, "content": "c", "status": "active",
            "confidence": 70, "created_at": "2026-01-01T00:00:00+00:00",
        })
        result = await privacy_d1.request_export(backend, "u-1")
        assert result and result["status"] == "completed"
        assert result["manifest"]["profile"]["id"] == "u-1"
        assert result["manifest"]["memories"][0]["id"] == "m-1"
        fetched = await privacy_d1.get_export(backend, "u-1", str(result["id"]))
        assert fetched and fetched["id"] == result["id"]
        assert await privacy_d1.get_export(backend, "other", str(result["id"])) is None
        listed = await privacy_d1.list_exports(backend, "u-1")
        assert len(listed) == 1 and listed[0]["status"] == "completed"

    async def test_queued_export_returned_as_is(self) -> None:
        backend = Backend()
        seed_user(backend)
        backend.store.tables["privacy_exports"].append({
            "id": "e-1", "user_id": "u-1", "status": "queued", "format": "json",
            "manifest": None, "archive_url": None, "archive_sha256": None, "error": None,
            "requested_at": "2026-01-01T00:00:00+00:00", "completed_at": None,
            "expires_at": None,
        })
        result = await privacy_d1.request_export(backend, "u-1")
        assert result and result["id"] == "e-1"


class TestDeletion:
    def _seed_data(self, backend: Backend) -> None:
        backend.store.tables["memory_entries"].append({"id": "m-1", "user_id": "u-1"})
        backend.store.tables["memory_relations"].append({
            "id": "r-1", "user_id": "u-1", "from_memory_id": "m-1",
            "to_memory_id": "m-1", "relation_type": "updates",
        })
        backend.store.tables["rag_documents"].append({"id": "d-1", "user_id": "u-1"})
        backend.store.tables["rag_chunks"].append({
            "id": "c-1", "user_id": "u-1", "document_id": "d-1",
        })
        backend.store.tables["schedules"].append({"id": "s-1", "user_id": "u-1"})
        backend.store.tables["usage_events"].append({"id": "e-1", "user_id": "u-1"})

    async def test_delete_my_data_cleans_and_queues_vectors(self) -> None:
        backend = Backend()
        seed_user(backend)
        self._seed_data(backend)
        job = await privacy_d1.delete_my_data(backend, "u-1")
        assert job and job["status"] == "completed"
        assert backend.store.tables["memory_entries"] == []
        assert backend.store.tables["memory_relations"] == []
        assert backend.store.tables["rag_documents"] == []
        assert backend.store.tables["rag_chunks"] == []
        assert backend.store.tables["schedules"] == []
        ops = backend.store.tables["vector_sync_outbox"]
        kinds = sorted((o["kind"], o["record_id"]) for o in ops)
        assert ("memory", "m-1") in kinds and ("rag", "c-1") in kinds
        assert all(o["operation"] == "delete" for o in ops)
        # repeat while running → same job; completed job → new run allowed
        again = await privacy_d1.delete_my_data(backend, "u-1")
        assert again and again["id"] != job["id"]
        jobs = await privacy_d1.list_deletion_jobs(backend, "u-1")
        assert len(jobs) == 2
        fetched = await privacy_d1.get_deletion_job(backend, "u-1", str(job["id"]))
        assert fetched and fetched["status"] == "completed"
        assert await privacy_d1.get_deletion_job(backend, "u-1", "missing") is None

    async def test_delete_account_wipes_sessions_and_soft_deletes(self) -> None:
        backend = Backend()
        seed_user(backend)
        self._seed_data(backend)
        backend.store.tables["session"].append({"id": "s-1", "user_id": "u-1"})
        backend.store.tables["mcp_connections"].append({
            "id": "mc-1", "user_id": "u-1", "provider": "notion", "oauth_tokens": "x",
        })
        job = await privacy_d1.delete_account(backend, "u-1")
        assert job and job["status"] == "completed"
        assert backend.store.tables["session"] == []
        assert backend.store.tables["memory_entries"] == []
        assert backend.store.tables["mcp_connections"] == []
        user = next(r for r in backend.store.tables["user"] if r["id"] == "u-1")
        assert user.get("deleted_at") is not None
        ops = backend.store.tables["vector_sync_outbox"]
        assert {o["record_id"] for o in ops} == {"m-1", "c-1"}

    async def test_overview_counts(self) -> None:
        backend = Backend()
        seed_user(backend)
        self._seed_data(backend)
        counts = await privacy_d1.overview_counts(backend, "u-1")
        assert counts["memories"] == 1 and counts["schedules"] == 1
        assert counts["usage"] == 1 and counts["sessions"] == 0
