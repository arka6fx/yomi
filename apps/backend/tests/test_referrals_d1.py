"""Behavioral tests for the D1 referrals flow (grant boundary stubbed)."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from yomi.services import referrals_d1
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.store import D1Store


class FakeReferrals(D1Store):
    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {"user": [], "referral_events": []}

    async def atomic(self, statements: list[Statement]) -> list[dict]:
        out = []
        for stmt in statements:
            if stmt.sql.startswith("INSERT"):
                match = re.match(r'INSERT (?:OR \w+ )?INTO "(\w+)" \((.+)\) VALUES', stmt.sql)
                assert match, stmt.sql
                cols = [c.strip().strip('"') for c in match.group(2).split(",")]
                row = dict(zip(cols, stmt.params, strict=True))
                if "OR IGNORE" in stmt.sql and any(
                    r.get("referred_user_id") == row.get("referred_user_id")
                    for r in self.tables["referral_events"]
                ):
                    out.append({"success": True})
                    continue
                self.tables[match.group(1)].append(row)
                out.append({"success": True})
            elif stmt.sql.startswith("UPDATE user SET referral_code"):
                for row in self.tables["user"]:
                    if row["id"] == stmt.params[-1]:
                        row["referral_code"] = stmt.params[0]
                out.append({"success": True})
            else:
                raise AssertionError(f"unsupported: {stmt.sql}")
        return out

    async def fetch_all(self, sql: str, params: list[Any] | None = None) -> list[dict]:
        p = list(params or [])
        if "FROM user" in sql and "referral_code = ?" in sql:
            return [r for r in self.tables["user"] if r.get("referral_code") == p[0]]
        if "FROM user" in sql:
            return [r for r in self.tables["user"] if r["id"] == p[0]]
        if "COUNT(*)" in sql:
            count = sum(
                1 for r in self.tables["referral_events"] if r["referrer_user_id"] == p[0]
            )
            return [{"n": count}]
        if "FROM referral_events" in sql and "referred_user_id = ?" in sql:
            return [r for r in self.tables["referral_events"] if r["referred_user_id"] == p[0]]
        if "FROM referral_events" in sql:
            rows = [r for r in self.tables["referral_events"] if r["referrer_user_id"] == p[0]]
            return rows[:100]
        raise AssertionError(f"unsupported query: {sql}")

    async def fetch_one(self, sql: str, params: list[Any] | None = None) -> dict | None:
        rows = await self.fetch_all(sql, params)
        return rows[0] if rows else None


class Backend:
    def __init__(self) -> None:
        self.store = FakeReferrals()
        self.client = None


def seed_user(backend: Backend, user_id: str, code: str | None = None) -> None:
    backend.store.tables["user"].append({"id": user_id, "referral_code": code})


class TestRedeem:
    async def test_happy_path_grants_referrer(self, monkeypatch) -> None:
        from yomi.services import billing_d1 as _billing

        calls: list[dict] = []

        async def fake_grant(backend, **kwargs):
            calls.append(kwargs)
            from yomi.services.credit_ledger import GrantResult

            return GrantResult(granted=True, balance=100)

        monkeypatch.setattr(referrals_d1, "grant_credits", fake_grant)
        monkeypatch.setattr(_billing, "grant_credits", fake_grant)
        backend = Backend()
        seed_user(backend, "referrer", code="ABCD1234")
        seed_user(backend, "newbie")
        res = await referrals_d1.redeem_referral_code(
            backend, code="ABCD1234", referred_user_id="newbie",
            referred_user_created_at=datetime.now(UTC),
        )
        assert res == {"redeemed": True}
        assert calls and calls[0]["user_id"] == "referrer"
        assert calls[0]["idempotency_key"].startswith("referral:")

    async def test_invalid_self_old_and_cap(self) -> None:
        backend = Backend()
        seed_user(backend, "referrer", code="CODE1")
        old = datetime(2020, 1, 1, tzinfo=UTC)
        assert (await referrals_d1.redeem_referral_code(
            backend, code="NOPE", referred_user_id="x", referred_user_created_at=datetime.now(UTC)
        ))["reason"] == "invalid_code"
        assert (await referrals_d1.redeem_referral_code(
            backend, code="CODE1", referred_user_id="referrer",
            referred_user_created_at=datetime.now(UTC),
        ))["reason"] == "self_referral"
        assert (await referrals_d1.redeem_referral_code(
            backend, code="CODE1", referred_user_id="oldie", referred_user_created_at=old
        ))["reason"] == "not_new_account"

    async def test_duplicate_recovery_regrants(self, monkeypatch) -> None:
        calls: list[dict] = []

        async def fake_grant(backend, **kwargs):
            calls.append(kwargs)
            from yomi.services.credit_ledger import GrantResult

            return GrantResult(granted=False, balance=100)

        monkeypatch.setattr(referrals_d1, "grant_credits", fake_grant)
        backend = Backend()
        seed_user(backend, "referrer", code="CODE1")
        backend.store.tables["referral_events"].append({
            "id": "evt-1", "referrer_user_id": "referrer", "referred_user_id": "newbie",
            "credits_granted": 100, "created_at": datetime.now(UTC).isoformat(),
        })
        res = await referrals_d1.redeem_referral_code(
            backend, code="CODE1", referred_user_id="newbie",
            referred_user_created_at=datetime.now(UTC),
        )
        assert res == {"redeemed": False, "reason": "already_redeemed"}
        assert calls and calls[0]["idempotency_key"] == "referral:evt-1:credit"

    async def test_stats_and_code_gen(self) -> None:
        backend = Backend()
        seed_user(backend, "u-1")
        stats = await referrals_d1.get_referral_stats(backend, "u-1")
        assert stats["count"] == 0 and stats["cap"] == 20 and len(stats["code"]) == 8
        again = await referrals_d1.get_referral_stats(backend, "u-1")
        assert again["code"] == stats["code"]
