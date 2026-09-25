"""Behavioral tests for the D1 billing module over an in-memory fake."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any

from yomi.services.ai_telemetry import AiUsageRecord
from yomi.services.billing_d1 import (
    charge_usage,
    consume_credits,
    create_payment_record,
    debit_credits,
    expire_credits,
    expire_user_credits,
    get_credit_summary,
    grant_credits,
    load_metering_user,
    recent_credit_transactions,
    record_ai_usage,
    record_payment_event,
    refund_credits,
    transaction_by_key,
    upsert_payment_record,
)
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.store import D1Store, utcnow_iso
from yomi.services.credit_pricing import UsagePricingInput, credits_for_usage
from yomi.services.metering import ChargeInput


class FakeBilling(D1Store):
    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {
            "credit_accounts": [],
            "credit_grants": [],
            "credit_transactions": [],
            "usage_events": [],
            "ai_usage_events": [],
            "processed_payment_events": [],
            "payment_records": [],
            "user": [],
        }

    def _insert(self, stmt: Statement) -> dict:
        match = re.match(r'INSERT (?:OR \w+ )?INTO "(\w+)" \((.+)\) VALUES', stmt.sql)
        assert match, stmt.sql
        table, ignore = match.group(1), "IGNORE" in stmt.sql
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
                "ai_usage_events": ["request_id"],
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
        if m := re.match(r"(\w+) = \?$", cond):
            return row.get(m.group(1)) == params[pos], pos + 1
        if m := re.match(r"(\w+) = '([^']*)'$", cond):
            return str(row.get(m.group(1))) == m.group(2), pos
        if m := re.match(r"(\w+) > \?$", cond):
            left, right = row.get(m.group(1)), params[pos]
            return (left is not None and left > right), pos + 1
        if m := re.match(r"(\w+) > (\d+)$", cond):
            left = row.get(m.group(1))
            return (left is not None and int(left) > int(m.group(2))), pos
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

    def _where(self, table: str, where: str, params: list) -> list[dict]:
        rows = []
        for row in self.tables[table]:
            pos, ok = 0, True
            for cond in self._split_top_level(where, "AND"):
                match, pos = self._eval(row, cond, params, pos)
                if not match:
                    ok = False
                    break
            if ok:
                rows.append(row)
        return rows

    def _apply_set(self, row: dict, assignments: str, params: list) -> int:
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
            elif m := re.match(r"(\w+) = '([^']*)'$", part):
                row[m.group(1)] = m.group(2)
            elif m := re.match(r"(\w+) = (\d+)$", part):
                row[m.group(1)] = int(m.group(2))
            else:
                raise AssertionError(f"unsupported set: {part}")
        return pos

    async def atomic(self, statements: list[Statement]) -> list[dict]:
        out = []
        for stmt in statements:
            sql = stmt.sql
            if sql.startswith("INSERT"):
                out.append(self._insert(stmt))
            elif sql.startswith("UPDATE credit_accounts"):
                set_part = sql.split("SET", 1)[1].split("WHERE")[0]
                where = sql.split("WHERE", 1)[1].split("RETURNING")[0]
                set_count = set_part.count("?")
                rows = self._where("credit_accounts", where, list(stmt.params)[set_count:])
                set_params = list(stmt.params)[:set_count]
                for row in rows:
                    self._apply_set(row, set_part, set_params)
                returned = (
                    [{"available_credits": rows[0]["available_credits"]}] if rows else []
                )
                out.append({"success": True, "results": returned})
            elif sql.startswith("UPDATE credit_grants"):
                set_part = sql.split("SET", 1)[1].split("WHERE")[0]
                where = sql.split("WHERE", 1)[1]
                set_count = set_part.count("?")
                rows = self._where("credit_grants", where, list(stmt.params)[set_count:])
                for row in rows:
                    self._apply_set(row, set_part, list(stmt.params)[:set_count])
                out.append({"success": True})
            elif sql.startswith("UPDATE usage_events"):
                rows = self._where("usage_events", "id = ?", [stmt.params[-1]])
                for row in rows:
                    row["credits_charged"] = stmt.params[0]
                out.append({"success": True})
            elif sql.startswith("UPDATE payment_records"):
                set_part = sql.split("SET", 1)[1].split("WHERE")[0]
                set_count = set_part.count("?")
                rows = self._where("payment_records", "id = ?", [stmt.params[-1]])
                for row in rows:
                    self._apply_set(row, set_part, list(stmt.params)[:set_count])
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
        if "FROM credit_transactions t LEFT JOIN" in sql:
            user_rows = [r for r in self.tables["credit_transactions"] if r["user_id"] == p[0]]
            user_rows.sort(key=lambda r: str(r["created_at"]), reverse=True)
            out = []
            for txn in user_rows[: int(p[1])]:
                usage = next(
                    (
                        u
                        for u in self.tables["usage_events"]
                        if u["id"] == txn.get("usage_event_id")
                    ),
                    {},
                )
                out.append({
                    "id": txn["id"], "type": txn["type"], "amount": txn["amount"],
                    "balance_after": txn["balance_after"], "reason": txn.get("reason"),
                    "usage_event_id": txn.get("usage_event_id"),
                    "usage_kind": usage.get("kind"),
                    "usage_credits_charged": usage.get("credits_charged"),
                    "usage_created_at": usage.get("created_at"),
                    "created_at": txn["created_at"],
                })
            return out
        if "FROM credit_grants" in sql and "ORDER BY CASE" in sql:
            rows = self._where("credit_grants", sql.split("WHERE", 1)[1].split("ORDER BY")[0], p)
            rows.sort(key=lambda r: (
                r.get("expires_at") is None,
                str(r.get("expires_at") or ""),
                str(r.get("created_at") or ""),
            ))
            return [{"id": r["id"], "credits_remaining": r["credits_remaining"]} for r in rows]
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
            rows = sorted(rows, key=lambda r: str(r.get("created_at") or ""), reverse="DESC" in sql)
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
        fake = FakeBilling()
        self.store = fake
        self.client = None


def pro_user(user_id: str = "u-1") -> dict:
    return {
        "id": user_id, "email": "u@example.test", "role": "user", "plan": "pro",
        "subscription_status": "active", "current_period_end": None, "trial_end_date": None,
    }


CHAT_COST = credits_for_usage("chat", UsagePricingInput())


class TestLedger:
    async def test_grant_and_summary(self) -> None:
        backend = Backend()
        res = await grant_credits(
            backend, user_id="u-1", amount=100, source="credit_pack", source_id="s-1",
            idempotency_key="k-1",
        )
        assert res.granted is True and res.balance == 100
        summary = await get_credit_summary(backend, "u-1")
        assert (summary.balance, summary.lifetime_granted) == (100, 100)
        # idempotent replay: no double grant
        replay = await grant_credits(
            backend, user_id="u-1", amount=100, source="credit_pack", source_id="s-1",
            idempotency_key="k-1",
        )
        assert replay.granted is False and replay.balance == 100
        assert (await get_credit_summary(backend, "u-1")).lifetime_granted == 100

    async def test_transaction_by_key(self) -> None:
        backend = Backend()
        assert await transaction_by_key(backend, "nope") is None
        await grant_credits(
            backend, user_id="u-1", amount=50, source="promo", source_id="p-1",
            idempotency_key="k-2",
        )
        found = await transaction_by_key(backend, "k-2")
        assert found and found.amount == 50 and found.balance_after == 50

    async def test_debit_guarded_and_insufficient(self) -> None:
        backend = Backend()
        short = await consume_credits(backend, user_id="u-9", amount=5, idempotency_key="k-9")
        assert short.ok is False and short.insufficient is True and short.balance == 0
        assert backend.store.tables["credit_transactions"] == []
        await grant_credits(
            backend, user_id="u-9", amount=10, source="promo", source_id="p-9",
            idempotency_key="k-8",
        )
        over = await consume_credits(backend, user_id="u-9", amount=11, idempotency_key="k-7")
        assert over.ok is False and over.insufficient is True
        ok = await consume_credits(backend, user_id="u-9", amount=4, idempotency_key="k-6")
        assert ok.ok is True and ok.balance == 6 and ok.charged == 4
        # replay is idempotent
        replay = await consume_credits(backend, user_id="u-9", amount=4, idempotency_key="k-6")
        assert replay.ok is True and replay.balance == 6

    async def test_refund_and_recent(self) -> None:
        backend = Backend()
        await grant_credits(
            backend, user_id="u-1", amount=20, source="promo", source_id="p-1",
            idempotency_key="k-1",
        )
        refund = await refund_credits(backend, user_id="u-1", amount=5, idempotency_key="k-r")
        assert refund.ok is True
        account = backend.store.tables["credit_accounts"][0]
        assert account["lifetime_refunded"] == 5
        recent = await recent_credit_transactions(backend, "u-1", 10)
        # Timestamps can tie on coarse clocks; order between them is unspecified
        # (same as Postgres ORDER BY created_at DESC), so assert the set.
        assert {r["type"] for r in recent} == {"refund", "grant"}

    async def test_expiry_sweep(self) -> None:
        backend = Backend()
        await grant_credits(
            backend, user_id="u-1", amount=30, source="promo", source_id="p-1",
            idempotency_key="k-1", expires_at=datetime.now(UTC) - timedelta(days=1),
        )
        await grant_credits(
            backend, user_id="u-1", amount=30, source="credit_pack", source_id="c-1",
            idempotency_key="k-2",
        )
        expired = await expire_credits(backend, user_id="u-1")
        assert expired == 30
        by_source = {g["source"]: g for g in backend.store.tables["credit_grants"]}
        assert by_source["promo"]["status"] == "expired"
        assert by_source["promo"]["credits_remaining"] == 0
        assert by_source["credit_pack"]["credits_remaining"] == 0
        summary = await get_credit_summary(backend, "u-1")
        assert (summary.balance, summary.lifetime_granted) == (30, 60)

    async def test_expiry_without_active_pool_is_noop(self) -> None:
        # Mirrors the Postgres original: the debit path only draws from
        # unexpired grants, so a lone expired grant cannot be swept on its own.
        backend = Backend()
        await grant_credits(
            backend, user_id="u-1", amount=30, source="promo", source_id="p-1",
            idempotency_key="k-1", expires_at=datetime.now(UTC) - timedelta(days=1),
        )
        assert await expire_credits(backend, user_id="u-1") == 0
        assert backend.store.tables["credit_grants"][0]["status"] == "active"

    async def test_expire_user_credits_by_source(self) -> None:
        backend = Backend()
        await grant_credits(
            backend, user_id="u-1", amount=10, source="promo", source_id="p-1",
            idempotency_key="k-1",
        )
        await grant_credits(
            backend, user_id="u-1", amount=10, source="credit_pack", source_id="c-1",
            idempotency_key="k-2",
        )
        total = await expire_user_credits(backend, "u-1", sources=["promo"])
        assert total == 10
        statuses = {g["source"]: g["status"] for g in backend.store.tables["credit_grants"]}
        assert statuses == {"promo": "expired", "credit_pack": "active"}


class TestCharge:
    async def test_chat_is_unlimited_and_still_logged(self) -> None:
        backend = Backend()  # no credits granted at all
        for plan, status in (("pro", "active"), ("explore", "inactive"), ("pro", "past_due")):
            user = pro_user()
            user["plan"] = plan
            user["subscription_status"] = status
            res = await charge_usage(backend, ChargeInput(user=user, kind="chat", units=1))
            assert res.ok is True and res.credits_charged == 0
        events = backend.store.tables["usage_events"]
        assert len(events) == 3 and events[0]["kind"] == "request_chat"
        assert all(e["credits_charged"] == 0 for e in events)

    async def test_load_metering_user(self) -> None:
        backend = Backend()
        assert await load_metering_user(backend, "ghost") is None
        backend.store.tables["user"].append({
            "id": "u-1", "email": "u@example.test", "role": "user", "plan": "pro",
            "subscription_status": "active", "trial_end_date": None,
            "current_period_end": None,
        })
        user = await load_metering_user(backend, "u-1")
        assert user and user["plan"] == "pro"


class TestPaymentsTelemetry:
    async def test_payment_event_dedup(self) -> None:
        backend = Backend()
        first = await record_payment_event(
            backend, provider="dodo", event_id="e-1", event_type="paid", payload_hash_value="h",
        )
        assert first == {"duplicate": False}
        second = await record_payment_event(
            backend, provider="dodo", event_id="e-1", event_type="paid", payload_hash_value="h",
        )
        assert second == {"duplicate": True}

    async def test_upsert_payment_record(self) -> None:
        backend = Backend()
        pid = await upsert_payment_record(
            backend, user_id="u-1", provider="dodo", kind="pack", product_key="pk",
            provider_order_id="o-1", amount_cents=500, currency="USD", status="created",
            metadata=None,
        )
        assert pid
        pid2 = await upsert_payment_record(
            backend, user_id="u-1", provider="dodo", kind="pack", product_key="pk",
            provider_order_id="o-1", amount_cents=500, currency="USD", status="paid",
            metadata=None,
        )
        assert pid2 == pid
        assert backend.store.tables["payment_records"][0]["status"] == "paid"

    async def test_telemetry_sanitizes_and_inserts(self) -> None:
        backend = Backend()
        await record_ai_usage(
            backend,
            AiUsageRecord(
                user_id="u-1", request_id="r-1", endpoint="chat", surface="telegram",
                status="done", model="gpt-5.4-mini", input_tokens=10, output_tokens=5,
                metadata={"prompt": "secret", "route": "agent"},
            ),
        )
        rows = backend.store.tables["ai_usage_events"]
        assert len(rows) == 1
        import json

        raw_meta = rows[0]["metadata"]
        meta = json.loads(raw_meta) if isinstance(raw_meta, str) else raw_meta
        assert meta == {"route": "agent"}
        # duplicate request_id is ignored
        await record_ai_usage(
            backend,
            AiUsageRecord(
                user_id="u-1", request_id="r-1", endpoint="chat", surface="telegram",
                status="done",
            ),
        )
        assert len(backend.store.tables["ai_usage_events"]) == 1

    async def test_create_payment_record_returns_id(self) -> None:
        backend = Backend()
        pid = await create_payment_record(
            backend, user_id="u-1", provider="dodo", kind="pack", product_key="pk",
            amount_cents=100, currency="USD", status="created", metadata=None,
        )
        assert pid
        assert pid == backend.store.tables["payment_records"][0]["id"]

    async def test_debit_helpers(self) -> None:
        backend = Backend()
        await grant_credits(
            backend, user_id="u-1", amount=10, source="promo", source_id="p-1",
            idempotency_key="k-1",
        )
        direct = await debit_credits(
            backend, user_id="u-1", amount=3, type_="adjustment", idempotency_key="k-a"
        )
        assert direct.ok is True and direct.balance == 7
        assert backend.store.tables["credit_accounts"][0]["updated_at"]
        # utcnow helper formats ISO timestamps
        assert isinstance(utcnow_iso(), str)
