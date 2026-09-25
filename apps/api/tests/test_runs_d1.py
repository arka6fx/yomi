"""Tests for the durable run ledger, telegram enqueue, and dispatch sweep."""

from __future__ import annotations

import re
from typing import Any

from yomi.services import runs_d1
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.store import D1Store


class FakeRuns(D1Store):
    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {
            "agent_runs": [],
            "agent_run_steps": [],
            "platform_connections": [],
            "user": [],
            "agent_sessions": [],
            "agent_messages": [],
            "credit_transactions": [],
            "credit_accounts": [],
            "credit_grants": [],
            "usage_events": [],
            "schedules": [],
        }

    def _insert(self, stmt: Statement) -> dict:
        match = re.match(r'INSERT (?:OR \w+ )?INTO "(\w+)" \((.+)\) VALUES', stmt.sql)
        assert match, stmt.sql
        table, ignore = match.group(1), "OR IGNORE" in stmt.sql
        cols = [c.strip().strip('"') for c in match.group(2).split(",")]
        row = dict(zip(cols, stmt.params, strict=True))
        if (
            ignore
            and table == "agent_runs"
            and row.get("update_id") is not None
            and any(r.get("update_id") == row["update_id"] for r in self.tables[table])
        ):
            return {"success": True}
        self.tables[table].append(row)
        return {"success": True}

    def _match(self, row: dict, cond: str, params: list, pos: int) -> tuple[bool, int]:
        cond = cond.strip()
        if cond.startswith("(") and cond.endswith(")"):
            width = cond.count("?")
            offset = pos
            for alt in cond[1:-1].split(" OR "):
                match, _ = self._match(row, alt, params, offset)
                if match:
                    return True, pos + width
                offset += alt.count("?")
            return False, pos + width
        if m := re.match(r"(\w+) = \?$", cond):
            return row.get(m.group(1)) == params[pos], pos + 1
        if m := re.match(r"(\w+) < \?$", cond):
            left, right = row.get(m.group(1)), params[pos]
            return (left is not None and str(left) < str(right)), pos + 1
        if m := re.match(r"(\w+) = '([^']*)'$", cond):
            return str(row.get(m.group(1))) == m.group(2), pos
        if m := re.match(r"(\w+) IS NULL$", cond):
            return row.get(m.group(1)) is None, pos
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
            elif m := re.match(r"(\w+) = (\w+) \+ (\d+)$", part):
                row[m.group(1)] = int(row[m.group(2)]) + int(m.group(3))
            elif m := re.match(r"(\w+) = (\w+) \+ \?$", part):
                row[m.group(1)] = int(row[m.group(2)]) + int(params[pos])
                pos += 1
            elif m := re.match(r"(\w+) = NULL$", part, re.IGNORECASE):
                row[m.group(1)] = None
            elif m := re.match(r"(\w+) = '([^']*)'$", part):
                row[m.group(1)] = m.group(2)
            else:
                raise AssertionError(f"unsupported set: {part}")

    async def atomic(self, statements: list[Statement]) -> list[dict]:
        out = []
        for stmt in statements:
            sql = stmt.sql
            if sql.startswith("INSERT"):
                out.append(self._insert(stmt))
            elif sql.startswith("DELETE FROM"):
                table = sql.split(" ")[2]
                where = sql.split("WHERE", 1)[1].split("RETURNING")[0]
                doomed = {id(r) for r in self._where(table, where, list(stmt.params))}
                if table == "agent_sessions":
                    doomed_session_ids = {
                        r["id"] for r in self.tables["agent_sessions"] if id(r) in doomed
                    }
                    self.tables["agent_messages"] = [
                        r for r in self.tables["agent_messages"]
                        if r["session_id"] not in doomed_session_ids
                    ]
                self.tables[table] = [r for r in self.tables[table] if id(r) not in doomed]
                out.append({"success": True})
            elif "IN (SELECT id FROM agent_runs" in sql:
                out.append(self._claim(sql, list(stmt.params)))
            elif sql.startswith("UPDATE"):
                set_part = sql.split("SET", 1)[1].split("WHERE")[0]
                where = sql.split("WHERE", 1)[1].split("RETURNING")[0]
                set_count = set_part.count("?")
                table = sql.split("UPDATE ", 1)[1].split(" ")[0]
                rows = self._where(table, where, list(stmt.params)[set_count:])
                for row in rows:
                    self._apply_set(row, set_part, list(stmt.params))
                if "RETURNING" in sql:
                    out.append({"success": True, "results": [dict(r) for r in rows]})
                else:
                    out.append({"success": True})
            else:
                raise AssertionError(f"unsupported: {sql}")
        return out

    def _claim(self, sql: str, params: list) -> dict:
        owner, lease_exp, now, cutoff, limit = params
        eligible = [
            r for r in self.tables["agent_runs"]
            if (r["status"] == "queued"
                or (r["status"] == "running" and str(r.get("lease_expires_at") or "") < cutoff))
            and int(r["attempts"]) < int(r["max_attempts"])
        ]
        eligible.sort(key=lambda r: str(r.get("created_at") or ""))
        claimed = eligible[: int(limit)]
        for row in claimed:
            row.update(status="running", lease_owner=owner, lease_expires_at=lease_exp,
                       updated_at=now, attempts=int(row["attempts"]) + 1)
        return {"success": True, "results": [dict(r) for r in claimed]}

    async def fetch_all(self, sql: str, params: list[Any] | None = None) -> list[dict]:
        p = list(params or [])
        if "JOIN agent_sessions s ON" in sql:
            user_id, platform, chat_id, limit = p
            sessions = {
                r["id"] for r in self.tables["agent_sessions"]
                if r["user_id"] == user_id and r["platform"] == platform
                and r["chat_id"] == chat_id and r["status"] == "active"
            }
            msgs = [r for r in self.tables["agent_messages"] if r["session_id"] in sessions]
            # insertion order == rowid order; query sorts DESC so newest comes first
            msgs = list(reversed(msgs[-int(limit):]))
            return [{"role": r["role"], "content": r["content"]} for r in msgs]
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
        if "LIMIT ?" in sql:
            rows = rows[: int(p[-1])]
        elif m := re.search(r"LIMIT (\d+)", sql):
            rows = rows[: int(m.group(1))]
        if cols == "*":
            return rows
        wanted = [c.strip().split(" ")[0].split(".")[-1] for c in cols.split(",")]
        return [{c: r.get(c) for c in wanted} for r in rows]

    async def fetch_one(self, sql: str, params: list[Any] | None = None) -> dict | None:
        rows = await self.fetch_all(sql, params)
        return rows[0] if rows else None


class Backend:
    def __init__(self) -> None:
        self.store = FakeRuns()
        self.client = None


class TestLedger:
    async def test_create_and_dedupe(self) -> None:
        backend = Backend()
        run, created = await runs_d1.create_run(
            backend, user_id="u-1", chat_id="c-1", update_id="100",
            kind="chat", input_text="hi",
        )
        assert created is True and run["status"] == "queued"
        same, created2 = await runs_d1.create_run(
            backend, user_id="u-1", chat_id="c-1", update_id="100",
            kind="chat", input_text="hi",
        )
        assert created2 is False and same["id"] == run["id"]
        assert len(backend.store.tables["agent_runs"]) == 1

    async def test_claim_complete_fail_cycle(self) -> None:
        backend = Backend()
        run, _ = await runs_d1.create_run(backend, user_id="u-1", chat_id="c-1")
        # running rows are not re-claimed while the lease is fresh
        await runs_d1.claim_due_runs(backend, "owner-a", lease_seconds=300, limit=10)
        assert await runs_d1.claim_due_runs(backend, "owner-b", limit=10) == []
        # expired lease becomes claimable again
        row = backend.store.tables["agent_runs"][0]
        row["lease_expires_at"] = "2000-01-01T00:00:00+00:00"
        claimed = await runs_d1.claim_due_runs(backend, "owner-b", limit=10)
        assert len(claimed) == 1 and claimed[0]["attempts"] == 2
        await runs_d1.heartbeat(backend, str(run["id"]))
        await runs_d1.record_step(backend, str(run["id"]), 0, "web_search", "done", "q", "r")
        steps = await runs_d1.get_run_steps(backend, str(run["id"]))
        assert len(steps) == 1 and steps[0]["tool_name"] == "web_search"
        await runs_d1.complete_run(backend, str(run["id"]), "done it")
        finished = await runs_d1.get_run(backend, str(run["id"]))
        assert finished and finished["status"] == "completed"
        assert finished["completed_at"] is not None

    async def test_fail_retries_then_terminal(self) -> None:
        backend = Backend()
        run, _ = await runs_d1.create_run(
            backend, user_id="u-1", chat_id="c-1", max_attempts=2)
        assert await runs_d1.fail_run(backend, str(run["id"]), "boom") == "queued"
        # First attempt consumed by a claim; expire its lease so the
        # second claim succeeds and exhausts the budget.
        await runs_d1.claim_due_runs(backend, "o", limit=10)
        backend.store.tables["agent_runs"][0]["lease_expires_at"] = "2000-01-01T00:00:00+00:00"
        await runs_d1.claim_due_runs(backend, "o", limit=10)
        row = await runs_d1.get_run(backend, str(run["id"]))
        assert row and int(row["attempts"]) >= 2
        assert await runs_d1.fail_run(backend, str(run["id"]), "boom") == "failed"
        row = await runs_d1.get_run(backend, str(run["id"]))
        assert row and row["status"] == "failed" and row["completed_at"] is not None

    async def test_claim_run_single(self) -> None:
        backend = Backend()
        run, _ = await runs_d1.create_run(backend, user_id="u-1", chat_id="c-1")
        claimed = await runs_d1.claim_run(backend, str(run["id"]), "w-1")
        assert claimed and claimed["status"] == "running"
        assert await runs_d1.claim_run(backend, str(run["id"]), "w-2") is None
        assert await runs_d1.claim_run(backend, "missing", "w-2") is None

    async def test_list_runs(self) -> None:
        backend = Backend()
        await runs_d1.create_run(backend, user_id="u-1", chat_id="c-1")
        await runs_d1.create_run(backend, user_id="u-1", chat_id="c-2")
        assert len(await runs_d1.list_runs(backend, "u-1")) == 2
        assert await runs_d1.list_runs(backend, "other") == []
        assert await runs_d1.get_run(backend, "missing") is None


class TestEnqueue:
    async def test_webhook_enqueues_and_dedupes(self, monkeypatch) -> None:
        import asyncio

        from yomi.gateway import telegram as tg

        backend = Backend()
        backend.store.tables["platform_connections"].append({
            "id": "pc-1", "user_id": "u-1", "platform": "telegram",
            "platform_user_id": "tg-1", "platform_chat_id": "chat-1",
        })
        backend.store.tables["user"].append({
            "id": "u-1", "email": "u@x.test", "role": "user", "plan": "pro",
            "subscription_status": "active", "current_period_end": None,
            "trial_end_date": None, "created_at": "2026-01-01T00:00:00+00:00",
        })
        calls: list[str] = []

        async def fake_background(run_id: str, *args: Any, **kwargs: Any) -> None:
            calls.append(run_id)

        monkeypatch.setattr(tg, "_background_telegram_run", fake_background)
        update = {"update_id": 4242, "message": {
            "message_id": 7, "chat": {"id": "chat-1"}, "from": {"id": "tg-1"}, "text": "hello"}}
        res = await tg._handle_update(update, None, backend)  # type: ignore[arg-type]
        assert res["status"] == "queued"
        await asyncio.sleep(0)
        assert calls and res["runId"] == calls[0]
        res2 = await tg._handle_update(update, None, backend)  # type: ignore[arg-type]
        assert res2 == {"status": "ok", "deduplicated": True}
        assert len(calls) == 1

    async def test_unlinked_user_gets_link_prompt(self) -> None:
        from yomi.gateway import telegram as tg

        backend = Backend()
        sent: list[str] = []
        import yomi.gateway.telegram as tgmod

        async def fake_send(chat_id: str | int, text: str) -> None:
            sent.append(text)

        orig = tgmod.send_message
        tgmod.send_message = fake_send  # type: ignore[assignment]
        try:
            update = {"update_id": 1, "message": {
                "message_id": 1, "chat": {"id": 5}, "from": {"id": 6}, "text": "hi"}}
            res = await tg._handle_update(update, None, backend)  # type: ignore[arg-type]
        finally:
            tgmod.send_message = orig
        assert res == {"status": "ok"} and sent and "isn't linked" in sent[0]


class TestDispatch:
    async def test_sweep_requires_key_and_processes(self, monkeypatch) -> None:
        from fastapi.testclient import TestClient

        from yomi.app.deps import get_db_session
        from yomi.app.main import create_app
        from yomi.services.cloudflare_storage.deps import get_d1_backend

        backend = Backend()
        backend.store.tables["user"].append({"id": "u-1"})
        run, _ = await runs_d1.create_run(
            backend, user_id="u-1", chat_id="c-1", kind="chat", input_text="hi")
        executed: list[str] = []

        from yomi.gateway import telegram as tg

        async def fake_execute(b, user, chat_id, message_id, text, kind, dur, run_id, plan):
            executed.append(run_id)
            await runs_d1.complete_run(b, run_id, "ok")

        async def fake_metering(b, user_id):
            return {"id": user_id, "plan": "explore", "subscription_status": "active"}

        async def _no_db():
            yield object()

        async def _fake_d1():
            yield backend

        monkeypatch.setattr(tg, "execute_telegram_run", fake_execute)
        monkeypatch.setattr("yomi.services.billing_d1.load_metering_user", fake_metering)
        monkeypatch.setattr("yomi.conf.settings.internal_api_key", "test-key")
        monkeypatch.setattr("yomi.conf.settings.storage_backend", "d1")

        app = create_app()
        app.dependency_overrides[get_db_session] = _no_db
        app.dependency_overrides[get_d1_backend] = _fake_d1
        with TestClient(app) as client:
            denied = client.post("/internal/dispatch")
            assert denied.status_code == 403
            denied2 = client.post("/internal/dispatch", headers={"x-yomi-internal": "wrong"})
            assert denied2.status_code == 403
            ok = client.post("/internal/dispatch", headers={"x-yomi-internal": "test-key"})
            assert ok.status_code == 200, ok.text
            assert ok.json() == {"scheduled": 0, "claimed": 1, "processed": 1}
            assert executed == [run["id"]]
            again = client.post("/internal/dispatch", headers={"x-yomi-internal": "test-key"})
            assert again.json() == {"scheduled": 0, "claimed": 0, "processed": 0}


class TestSessions:
    async def test_append_load_clear_round_trip(self) -> None:
        from yomi.services.agent import sessions_d1

        backend = Backend()
        assert await sessions_d1.load_history(backend, "u-1", "telegram", "c-1") == []
        await sessions_d1.append_turn(backend, "u-1", "telegram", "c-1", "user", "hi")
        await sessions_d1.append_turn(backend, "u-1", "telegram", "c-1", "assistant", "yo")
        history = await sessions_d1.load_history(backend, "u-1", "telegram", "c-1")
        assert history == [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "yo"},
        ]
        session_id = await sessions_d1.get_or_create_session(backend, "u-1", "telegram", "c-1")
        assert isinstance(session_id, str)
        await sessions_d1.clear_history(backend, "u-1", "telegram", "c-1")
        assert await sessions_d1.load_history(backend, "u-1", "telegram", "c-1") == []
        assert backend.store.tables["agent_messages"] == []

    async def test_history_limit_and_isolation(self) -> None:
        from yomi.services.agent import sessions_d1

        backend = Backend()
        for index in range(65):
            await sessions_d1.append_turn(
                backend, "u-1", "telegram", "c-1", "user", f"m{index}")
        history = await sessions_d1.load_history(backend, "u-1", "telegram", "c-1")
        assert len(history) == 60 and history[0]["content"] == "m5"
        assert await sessions_d1.load_history(backend, "u-1", "telegram", "other") == []
        assert await sessions_d1.load_history(backend, "u-2", "telegram", "c-1") == []


class TestIdempotentCharge:
    async def test_retried_run_is_never_charged(self) -> None:
        from yomi.services import billing_d1
        from yomi.services.metering import ChargeInput

        backend = Backend()
        backend.store.tables["credit_accounts"].append({
            "user_id": "u-1", "available_credits": 50, "lifetime_granted": 50,
            "lifetime_consumed": 0, "lifetime_refunded": 0, "updated_at": "now",
        })
        backend.store.tables["credit_transactions"].append({
            "id": "t-1", "user_id": "u-1", "grant_id": None, "usage_event_id": "e-1",
            "payment_id": None, "type": "consume", "amount": -1, "balance_after": 49,
            "idempotency_key": "run:run-1:charge", "reason": "chat usage",
            "metadata": "{}", "created_at": "now",
        })
        user = {"id": "u-1", "plan": "pro", "subscription_status": "active"}
        res = await billing_d1.charge_usage(
            backend, ChargeInput(user=user, kind="chat", units=1),
            idempotency_key="run:run-1:charge",
        )
        # credits are retired: a retried run is never charged again
        assert res.ok is True and res.credits_charged == 0
        assert len(backend.store.tables["credit_transactions"]) == 1
