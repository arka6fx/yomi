"""Tests for the D1 Dodo webhook chain (user updates, payments, grants)."""

from __future__ import annotations

import re
from typing import Any

from yomi.app.routes import billing as billing_routes
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.store import D1Store


class FakeWebhooks(D1Store):
    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {
            "user": [],
            "payment_records": [],
            "usage_events": [],
            "credit_accounts": [],
            "credit_grants": [],
            "credit_transactions": [],
            "processed_payment_events": [],
        }

    def _insert(self, stmt: Statement) -> dict:
        match = re.match(r'INSERT (?:OR \w+ )?INTO "(\w+)" \((.+)\) VALUES', stmt.sql)
        assert match, stmt.sql
        table, ignore = match.group(1), "OR IGNORE" in stmt.sql
        cols = [c.strip().strip('"') for c in match.group(2).split(",")]
        row = dict(zip(cols, stmt.params, strict=True))
        if ignore:
            uniques = {
                "credit_accounts": ["user_id"],
                "credit_grants": [("source", "source_id")],
                "payment_records": [
                    ("provider", "provider_payment_id"),
                    ("provider", "provider_order_id"),
                ],
                "processed_payment_events": [("provider", "event_id")],
            }
            for key in uniques.get(table, []):
                keys = [key] if isinstance(key, str) else list(key)
                if any(
                    all(r.get(k) == row.get(k) and row.get(k) is not None for k in keys)
                    for r in self.tables[table]
                ):
                    return {"success": True}
        self.tables[table].append(row)
        return {"success": True}

    def _match(self, row: dict, cond: str, params: list, pos: int) -> tuple[bool, int]:
        cond = cond.strip()
        if cond.startswith("(") and cond.endswith(")"):
            width = cond.count("?")
            for alt in cond[1:-1].split(" OR "):
                match, _ = self._match(row, alt, params, pos)
                if match:
                    return True, pos + width
            return False, pos + width
        if m := re.match(r"(\w+) = \?$", cond):
            return row.get(m.group(1)) == params[pos], pos + 1
        if m := re.match(r"(\w+) = '([^']*)'$", cond):
            return str(row.get(m.group(1))) == m.group(2), pos
        if m := re.match(r"(\w+) > \?$", cond):
            left, right = row.get(m.group(1)), params[pos]
            return (left is not None and left > right), pos + 1
        if m := re.match(r"(\w+) > (\d+)$", cond):
            return (row.get(m.group(1)) is not None
                    and int(row.get(m.group(1))) > int(m.group(2))), pos
        if m := re.match(r"(\w+) <= \?$", cond):
            left, right = row.get(m.group(1)), params[pos]
            return (left is not None and str(left) <= str(right)), pos + 1
        if m := re.match(r"(\w+) >= \?$", cond):
            left, right = row.get(m.group(1)), params[pos]
            return (left is not None and int(left) >= int(right)), pos + 1
        if m := re.match(r"(\w+) IS NULL$", cond):
            return row.get(m.group(1)) is None, pos
        if m := re.match(r"(\w+) IS NOT NULL$", cond):
            return row.get(m.group(1)) is not None, pos
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
            elif m := re.match(r"(\w+) = (\w+) \+ \?$", part):
                row[m.group(1)] = int(row[m.group(2)]) + int(params[pos])
                pos += 1
            elif m := re.match(r"(\w+) = (\w+) - \?$", part):
                row[m.group(1)] = int(row[m.group(2)]) - int(params[pos])
                pos += 1
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
                where = sql.split("WHERE", 1)[1]
                doomed = {id(r) for r in self._where(table, where, list(stmt.params))}
                self.tables[table] = [r for r in self.tables[table] if id(r) not in doomed]
                out.append({"success": True})
            elif sql.startswith("UPDATE"):
                set_part = sql.split("SET", 1)[1].split("WHERE")[0]
                where = sql.split("WHERE", 1)[1].split("RETURNING")[0]
                set_count = set_part.count("?")
                rows = self._where(
                    sql.split("UPDATE ", 1)[1].split(" ")[0], where,
                    list(stmt.params)[set_count:],
                )
                for row in rows:
                    self._apply_set(row, set_part, list(stmt.params)[:set_count])
                if "RETURNING" in sql:
                    col = sql.split("RETURNING", 1)[1].strip().split(" ")[0]
                    returned = [{col: r[col]} for r in rows]
                    out.append({"success": True, "results": returned})
                else:
                    out.append({"success": True})
            else:
                raise AssertionError(f"unsupported: {sql}")
        return out

    async def fetch_all(self, sql: str, params: list[Any] | None = None) -> list[dict]:
        p = list(params or [])
        if "COALESCE(SUM(credits_remaining)" in sql:
            rows = self._where("credit_grants", sql.split("WHERE", 1)[1], p)
            total = sum(int(r["credits_remaining"]) for r in rows)
            dates = sorted(str(r["expires_at"]) for r in rows if r.get("expires_at"))
            return [{"total": total, "soonest": dates[0] if dates else None}]
        if "ORDER BY CASE" in sql:
            rows = self._where("credit_grants", sql.split("WHERE", 1)[1].split("ORDER BY")[0], p)
            rows.sort(key=lambda r: (
                r.get("expires_at") is None, str(r.get("expires_at") or ""),
                str(r.get("created_at") or ""),
            ))
            cols = sql.split("SELECT", 1)[1].split("FROM")[0]
            wanted = [c.strip().split(" ")[0].split(".")[-1] for c in cols.split(",")]
            return [{c: r.get(c) for c in wanted} for r in rows]
        match = re.search(r"FROM (\w+)", sql)
        assert match, sql
        table = match.group(1)
        cols = sql.split("SELECT", 1)[1].split("FROM")[0].strip()
        if "WHERE" in sql:
            where = sql.split("WHERE", 1)[1].split("ORDER BY")[0].split("LIMIT")[0]
            rows = self._where(table, where, p)
        else:
            rows = list(self.tables[table])
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
        self.store = FakeWebhooks()
        self.client = None


def seed_user(backend: Backend, user_id: str = "u-1") -> None:
    backend.store.tables["user"].append({
        "id": user_id, "plan": "explore", "subscription_status": "inactive",
        "dodo_subscription_id": None, "dodo_customer_id": None, "current_period_end": None,
    })


class TestWebhookChain:
    async def test_subscription_active_upgrades_and_grants(self) -> None:
        backend = Backend()
        seed_user(backend)
        entity = {
            "subscription_id": "sub-1", "customer_id": "cus-1",
            "metadata": {"userId": "u-1", "kind": "subscription", "plan": "pro"},
        }
        await billing_routes.handle_dodo_event_d1(backend, "subscription.active", entity, "ev-1")
        user = backend.store.tables["user"][0]
        assert user["plan"] == "pro" and user["subscription_status"] == "active"
        assert user["dodo_subscription_id"] == "sub-1"
        payments = backend.store.tables["payment_records"]
        assert len(payments) == 1 and payments[0]["status"] == "paid"
        grants = backend.store.tables["credit_grants"]
        assert len(grants) == 1 and grants[0]["source"] == "subscription_cycle"
        assert grants[0]["credits_granted"] == 300

    async def test_subscription_active_resolves_user_by_sub_id(self) -> None:
        backend = Backend()
        seed_user(backend)
        backend.store.tables["user"][0]["dodo_subscription_id"] = "sub-9"
        entity = {"subscription_id": "sub-9", "metadata": {"kind": "subscription", "plan": "pro"}}
        await billing_routes.handle_dodo_event_d1(backend, "subscription.renewed", entity, "ev-2")
        assert backend.store.tables["user"][0]["subscription_status"] == "active"

    async def test_payment_succeeded_grants_pack(self) -> None:
        backend = Backend()
        seed_user(backend)
        entity = {
            "payment_id": "pay-1", "amount": 500, "currency": "USD",
            "metadata": {"kind": "credit_pack", "userId": "u-1", "productKey": "credits_500"},
        }
        await billing_routes.handle_dodo_event_d1(backend, "payment.succeeded", entity, "ev-3")
        grants = backend.store.tables["credit_grants"]
        assert len(grants) == 1 and grants[0]["source"] == "credit_pack"

    async def test_subscription_end_downgrades(self) -> None:
        backend = Backend()
        seed_user(backend)
        backend.store.tables["user"][0].update(
            plan="pro", subscription_status="active", dodo_subscription_id="sub-1"
        )
        entity = {"subscription_id": "sub-1", "metadata": {"userId": "u-1"}}
        await billing_routes.handle_dodo_event_d1(backend, "subscription.cancelled", entity, "ev-4")
        user = backend.store.tables["user"][0]
        assert user["plan"] == "explore" and user["subscription_status"] == "inactive"
        assert user["dodo_subscription_id"] is None

    async def test_payment_failed_marks_past_due(self) -> None:
        backend = Backend()
        seed_user(backend)
        entity = {"subscription_id": "sub-1", "metadata": {"userId": "u-1"}}
        await billing_routes.handle_dodo_event_d1(backend, "subscription.past_due", entity, "ev-5")
        assert backend.store.tables["user"][0]["subscription_status"] == "past_due"

    async def test_on_hold_and_paused_mark_past_due(self) -> None:
        for type_ in ("subscription.on_hold", "subscription.paused"):
            backend = Backend()
            seed_user(backend)
            entity = {"subscription_id": "sub-1", "metadata": {"userId": "u-1"}}
            await billing_routes.handle_dodo_event_d1(backend, type_, entity, f"ev-{type_}")
            assert backend.store.tables["user"][0]["subscription_status"] == "past_due"

    async def test_unpaused_is_not_marked_past_due(self) -> None:
        backend = Backend()
        seed_user(backend)
        entity = {"subscription_id": "sub-1", "metadata": {"userId": "u-1"}}
        await billing_routes.handle_dodo_event_d1(backend, "subscription.unpaused", entity, "ev-u")
        assert backend.store.tables["user"][0]["subscription_status"] == "inactive"

    async def test_unknown_user_is_ignored(self) -> None:
        backend = Backend()
        entity = {"metadata": {"kind": "subscription", "plan": "pro"}}
        await billing_routes.handle_dodo_event_d1(backend, "subscription.active", entity, "ev-6")
        assert backend.store.tables["payment_records"] == []
