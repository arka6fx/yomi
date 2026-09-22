"""Behavioral tests for the D1 schedules and streaks backends."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from yomi.services import schedules_d1, streaks_d1
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.store import D1Store


class FakeMisc(D1Store):
    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {
            "schedules": [],
            "user": [],
        }

    def _insert(self, stmt: Statement) -> dict:
        match = re.match(r'INSERT (?:OR \w+ )?INTO "(\w+)" \((.+)\) VALUES', stmt.sql)
        assert match, stmt.sql
        cols = [c.strip().strip('"') for c in match.group(2).split(",")]
        self.tables[match.group(1)].append(dict(zip(cols, stmt.params, strict=True)))
        return {"success": True}

    def _match(self, row: dict, cond: str, params: list, pos: int) -> tuple[bool, int]:
        cond = cond.strip()
        if m := re.match(r"(\w+) = \?$", cond):
            return row.get(m.group(1)) == params[pos], pos + 1
        if m := re.match(r"(\w+) != \?$", cond):
            return row.get(m.group(1)) != params[pos], pos + 1
        if m := re.match(r"(\w+) = (\d+)$", cond):
            return int(row.get(m.group(1)) or 0) == int(m.group(2)), pos
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
            elif m := re.match(r"(\w+) = (\d+)$", part):
                row[m.group(1)] = int(m.group(2))
            elif m := re.match(r"(\w+) = NULL$", part, re.IGNORECASE):
                row[m.group(1)] = None
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
                self.tables[table] = [r for r in self.tables[table] if id(r) not in doomed]
                out.append({
                    "success": True,
                    "results": [{"id": 1} for _ in doomed] if "RETURNING" in sql else [],
                })
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
            desc = "DESC" in sql
            col = sql.split("ORDER BY", 1)[1].split("LIMIT")[0].strip().split(" ")[0].split(".")[-1]
            rows = sorted(rows, key=lambda r: str(r.get(col) or ""), reverse=desc)
            if "," in sql.split("ORDER BY", 1)[1].split("LIMIT")[0]:
                second = sql.split("ORDER BY", 1)[1].split("LIMIT")[0].split(",")[1].strip()
                col2 = second.split(" ")[0]
                rows = sorted(rows, key=lambda r: str(r.get(col2) or ""))
                first = sql.split("ORDER BY", 1)[1].split("LIMIT")[0].split(",")[0].strip()
                col1, desc1 = first.split(" ")[0], "DESC" in first
                rows = sorted(rows, key=lambda r: str(r.get(col1) or ""), reverse=desc1)
        if "COUNT(*)" in cols:
            return [{"n": len(rows)}]
        if "LIMIT ?" in sql:
            rows = rows[: int(p[-1])]
        if cols == "*":
            return rows
        wanted = [c.strip().split(" ")[0].split(".")[-1] for c in cols.split(",")]
        return [{c: r.get(c) for c in wanted} for r in rows]

    async def fetch_one(self, sql: str, params: list[Any] | None = None) -> dict | None:
        rows = await self.fetch_all(sql, params)
        return rows[0] if rows else None


class Backend:
    def __init__(self) -> None:
        self.store = FakeMisc()
        self.client = None


def seed_user(backend: Backend, user_id: str = "u-1", **overrides: Any) -> None:
    row = {
        "id": user_id, "current_streak": 3, "longest_streak": 7,
        "total_messages_sent": 42, "leaderboard_opt_in": 1,
        "leaderboard_handle": None, "leaderboard_show_photo": 1,
        "image": None, "plan": "pro", "deleted_at": None,
    }
    row.update(overrides)
    backend.store.tables["user"].append(row)


class TestSchedules:
    async def test_crud_round_trip(self) -> None:
        backend = Backend()
        created = await schedules_d1.create_schedule(
            backend, "u-1", schedule="every day at 9am", schedule_type="phrase",
            prompt="digest", deliver_to=["telegram"], enabled=True,
            next_run_at=datetime.now(UTC),
        )
        assert created["oneShot"] is False and created["runCount"] == 0
        assert created["deliverTo"] == ["telegram"]
        listed = await schedules_d1.list_schedules(backend, "u-1")
        assert len(listed) == 1
        updated = await schedules_d1.update_schedule(
            backend, "u-1", str(created["id"]), {"prompt": "new prompt", "enabled": 0}
        )
        assert updated and updated["prompt"] == "new prompt"
        assert await schedules_d1.delete_schedule(backend, "u-1", str(created["id"])) == 1
        assert await schedules_d1.delete_schedule(backend, "u-1", str(created["id"])) == 0
        assert await schedules_d1.get_schedule(backend, "u-1", "missing") is None

    async def test_quota_counts_and_limits(self, monkeypatch) -> None:
        backend = Backend()
        monkeypatch.setattr(schedules_d1, "schedule_limit_for_plan", lambda _plan: 1)
        ok = await schedules_d1.ensure_schedule_capacity(backend, {"id": "u-1", "plan": "pro"})
        assert ok == {"ok": True}
        await schedules_d1.create_schedule(
            backend, "u-1", schedule="s", schedule_type="phrase", prompt="p",
            deliver_to=["telegram"], enabled=True, next_run_at=None,
        )
        denied = await schedules_d1.ensure_schedule_capacity(backend, {"id": "u-1", "plan": "pro"})
        assert denied["ok"] is False and denied["status"] == 402
        monkeypatch.setattr(schedules_d1, "schedule_limit_for_plan", lambda _plan: 0)
        blocked = await schedules_d1.ensure_schedule_capacity(backend, {"id": "u-1", "plan": "x"})
        assert blocked["ok"] is False and blocked["status"] == 403


class TestStreaks:
    async def test_stats_and_defaults(self) -> None:
        backend = Backend()
        seed_user(backend)
        stats = await streaks_d1.get_streak_stats(backend, "u-1")
        assert stats["currentStreak"] == 3 and stats["leaderboardOptIn"] is True
        assert (await streaks_d1.get_streak_stats(backend, "ghost"))["plan"] == "explore"

    async def test_handle_validation_and_uniqueness(self) -> None:
        backend = Backend()
        seed_user(backend, "u-1")
        seed_user(backend, "u-2", leaderboard_handle="taken-handle")
        bad = await streaks_d1.update_leaderboard_handle(backend, "u-1", "BAD HANDLE!")
        assert bad["ok"] is False
        clash = await streaks_d1.update_leaderboard_handle(backend, "u-1", "taken-handle")
        assert clash["ok"] is False
        good = await streaks_d1.update_leaderboard_handle(backend, "u-1", "swift-otter")
        assert good == {"ok": True, "leaderboardHandle": "swift-otter"}

    async def test_opt_in_and_photo(self) -> None:
        backend = Backend()
        seed_user(backend)
        res = await streaks_d1.set_leaderboard_opt_in(backend, "u-1", False)
        assert res == {"leaderboardOptIn": False, "leaderboardHandle": None}
        photo = await streaks_d1.set_leaderboard_show_photo(backend, "u-1", False)
        assert photo == {"leaderboardShowPhoto": False}

    async def test_leaderboard_ranking(self) -> None:
        backend = Backend()
        seed_user(backend, "u-1", total_messages_sent=10, leaderboard_handle="me-handle")
        seed_user(backend, "u-2", total_messages_sent=99, leaderboard_handle="top-handle")
        seed_user(backend, "u-3", total_messages_sent=1, leaderboard_opt_in=0)
        board = await streaks_d1.get_leaderboard(backend, "u-1")
        assert [e["handle"] for e in board["entries"]] == ["top-handle", "me-handle"]
        assert board["yourRank"] == 2
        assert board["entries"][0]["isYou"] is False
        assert board["entries"][1]["isYou"] is True
        stranger = await streaks_d1.get_leaderboard(backend, "ghost")
        assert stranger["yourRank"] is None
