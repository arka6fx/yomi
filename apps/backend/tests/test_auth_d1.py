"""Behavioral tests for the D1 auth backend over an in-memory fake."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from yomi.services import auth_d1
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.store import D1Store
from yomi.services.privacy.consent import ConsentContext


class FakeAuth(D1Store):
    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {
            "user": [],
            "session": [],
            "verification": [],
            "account": [],
            "privacy_preferences": [],
            "privacy_consents": [],
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

    async def atomic(self, statements: list[Statement]) -> list[dict]:
        out = []
        for stmt in statements:
            sql = stmt.sql
            if sql.startswith("INSERT"):
                out.append(self._insert(stmt))
            elif sql.startswith("DELETE FROM"):
                table = sql.split(" ")[2]
                before = len(self.tables[table])
                cond = sql.split("WHERE", 1)[1]
                doomed = {id(r) for r in self._where(table, cond, list(stmt.params))}
                self.tables[table] = [r for r in self.tables[table] if id(r) not in doomed]
                out.append({"success": True, "changes": before - len(self.tables[table])})
            elif sql.startswith("UPDATE account SET"):
                set_part = sql.split("SET", 1)[1].split("WHERE")[0]
                cols = [p.strip().split(" ")[0] for p in set_part.split(",")]
                rows = self._where("account", "id = ?", [stmt.params[-1]])
                for row in rows:
                    for col, value in zip(cols, stmt.params, strict=False):
                        row[col] = value
                out.append({"success": True})
            elif sql.startswith("UPDATE privacy_preferences SET"):
                set_part = sql.split("SET", 1)[1].split("WHERE")[0]
                cols = [p.strip().split(" ")[0] for p in set_part.split(",")]
                rows = self._where("privacy_preferences", "user_id = ?", [stmt.params[-1]])
                for row in rows:
                    for col, value in zip(cols, stmt.params, strict=False):
                        row[col] = value
                out.append({"success": True})
            elif sql.startswith("UPDATE user SET consent_version"):
                rows = self._where("user", "id = ?", [stmt.params[-1]])
                for row in rows:
                    row.update(
                        consent_version=stmt.params[0], consent_timestamp=stmt.params[1],
                        privacy_policy_version=stmt.params[2], terms_version=stmt.params[3],
                    )
                out.append({"success": True})
            else:
                raise AssertionError(f"unsupported: {sql}")
        return out

    async def fetch_all(self, sql: str, params: list[Any] | None = None) -> list[dict]:
        p = list(params or [])
        match = re.search(r"FROM (\w+)", sql)
        assert match, sql
        table = match.group(1)
        if "WHERE" in sql:
            where = sql.split("WHERE", 1)[1].split("ORDER BY")[0].split("LIMIT")[0]
            rows = self._where(table, where, p)
        else:
            rows = list(self.tables[table])
        if "ORDER BY created_at DESC" in sql:
            rows = sorted(rows, key=lambda r: str(r.get("created_at") or ""), reverse=True)
        if "LIMIT ?" in sql:
            rows = rows[: int(p[-1])]
        elif m := re.search(r"LIMIT (\d+)", sql):
            rows = rows[: int(m.group(1))]
        return rows

    async def fetch_one(self, sql: str, params: list[Any] | None = None) -> dict | None:
        rows = await self.fetch_all(sql, params)
        return rows[0] if rows else None


class Backend:
    def __init__(self) -> None:
        self.store = FakeAuth()
        self.client = None


def user_row(user_id: str = "u-1", **overrides: Any) -> dict:
    now = datetime.now(UTC).isoformat()
    row = {
        "id": user_id, "name": "U", "email": "u@example.test", "email_verified": 0,
        "image": None, "created_at": now, "updated_at": now, "role": "user",
        "plan": "pro", "subscription_status": "active", "trial_interaction_limit": 100,
        "trial_interaction_used": 0, "daily_chat_count": 0, "daily_voice_count": 0,
        "daily_image_count": 0, "agent_usage_count": 0, "soul_onboarding": "unprompted",
        "current_streak": 0, "longest_streak": 0, "total_messages_sent": 0,
        "leaderboard_opt_in": 1, "leaderboard_show_photo": 1,
        "privacy_preferences": "{}", "export_count": 0,
    }
    row.update(overrides)
    return row


class TestSessions:
    async def test_create_find_delete_session(self) -> None:
        backend = Backend()
        backend.store.tables["user"].append(user_row())
        sess = await auth_d1.create_session(
            backend, user_id="u-1", token="tok-1",
            expires_at=(datetime.now(UTC) + timedelta(days=7)).isoformat(),
        )
        assert sess.token == "tok-1"
        found = await auth_d1.find_session_by_token(backend, "tok-1")
        assert found and found.user_id == "u-1"
        await auth_d1.delete_session_by_token(backend, "tok-1")
        assert await auth_d1.find_session_by_token(backend, "tok-1") is None

    async def test_resolve_session_happy_path(self) -> None:
        backend = Backend()
        backend.store.tables["user"].append(user_row())
        await auth_d1.create_session(
            backend, user_id="u-1", token="raw-token",
            expires_at=(datetime.now(UTC) + timedelta(days=7)).isoformat(),
        )
        from yomi.services.session_cookie import sign_token

        sess, user, value = await auth_d1.resolve_session(
            backend, sign_token("secret", "raw-token"), "secret"
        )
        assert sess and user and user.id == "u-1" and value is not None

    async def test_resolve_session_expired_is_deleted(self) -> None:
        backend = Backend()
        backend.store.tables["user"].append(user_row())
        await auth_d1.create_session(
            backend, user_id="u-1", token="old",
            expires_at=(datetime.now(UTC) - timedelta(days=1)).isoformat(),
        )
        from yomi.services.session_cookie import sign_token

        sess, user, value = await auth_d1.resolve_session(
            backend, sign_token("secret", "old"), "secret"
        )
        assert sess is None and user is None and value is not None
        assert backend.store.tables["session"] == []

    async def test_resolve_session_missing_and_bad_cookie(self) -> None:
        backend = Backend()
        assert await auth_d1.resolve_session(backend, None, "secret") == (None, None, None)
        sess, _, value = await auth_d1.resolve_session(backend, "garbage", "secret")
        assert sess is None and value == "garbage"

    async def test_load_request_user_401s(self) -> None:
        from fastapi import HTTPException

        backend = Backend()
        with pytest.raises(HTTPException) as exc:
            await auth_d1.load_request_user(backend, "nope")
        assert exc.value.status_code == 401

    async def test_revoke_all_sessions(self) -> None:
        backend = Backend()
        backend.store.tables["user"].append(user_row())
        for token in ("a", "b"):
            await auth_d1.create_session(
                backend, user_id="u-1", token=token,
                expires_at=(datetime.now(UTC) + timedelta(days=7)).isoformat(),
            )
        await auth_d1.delete_user_sessions(backend, "u-1")
        assert backend.store.tables["session"] == []


class TestUsersVerificationAccounts:
    async def test_create_and_find_user(self) -> None:
        backend = Backend()
        user = await auth_d1.create_user(backend, {"id": "u-9", "email": "n@example.test"})
        assert user.plan == "explore" and user.email_verified is False
        assert await auth_d1.find_user_by_email(backend, "n@example.test") is not None
        assert await auth_d1.find_user_by_id(backend, "missing") is None

    async def test_verification_single_use(self) -> None:
        backend = Backend()
        await auth_d1.create_verification(
            backend, identifier="st-1", value="{}", expires_at="2999-01-01T00:00:00+00:00",
            now=datetime.now(UTC).isoformat(),
        )
        first = await auth_d1.consume_verification(backend, "st-1")
        assert first and first["identifier"] == "st-1"
        assert await auth_d1.consume_verification(backend, "st-1") is None

    async def test_account_link_and_touch(self) -> None:
        backend = Backend()
        now = datetime.now(UTC).isoformat()
        await auth_d1.link_account(backend, {
            "id": "a-1", "account_id": "gh-1", "provider_id": "github", "user_id": "u-1",
            "access_token": "t1", "created_at": now, "updated_at": now,
        })
        found = await auth_d1.find_account(backend, "u-1", "github", "gh-1")
        assert found and found["access_token"] == "t1"
        await auth_d1.touch_account(backend, "a-1", {"access_token": "t2", "updated_at": now})
        found = await auth_d1.find_account(backend, "u-1", "github", "gh-1")
        assert found and found["access_token"] == "t2"
        assert await auth_d1.find_account(backend, "u-1", "github", "nope") is None


class TestConsent:
    async def test_check_consent_defaults_to_denied(self) -> None:
        backend = Backend()
        backend.store.tables["user"].append(user_row())
        result = await auth_d1.check_consent(backend, "u-1", "memory")
        assert result.allowed is False and result.decided is False

    async def test_check_consent_unknown_purpose(self) -> None:
        backend = Backend()
        result = await auth_d1.check_consent(backend, "u-1", "nope")
        assert result.allowed is False and result.decided is True

    async def test_record_and_check_grant(self) -> None:
        backend = Backend()
        backend.store.tables["user"].append(user_row())
        snaps = await auth_d1.record_consent_decision(
            backend, user_id="u-1", purposes=["memory"],
            status="granted", context=ConsentContext(),
        )
        assert [s.purpose for s in snaps] == ["memory"]
        result = await auth_d1.check_consent(backend, "u-1", "memory")
        assert result.allowed is True and result.decided is True
        prefs = await auth_d1.get_privacy_preferences(backend, "u-1")
        assert prefs.memory_enabled is True
        history = await auth_d1.list_consent_history(backend, "u-1")
        assert history[0]["purpose"] == "memory"

    async def test_grant_if_undecided_skips_decided(self) -> None:
        backend = Backend()
        backend.store.tables["user"].append(user_row())
        await auth_d1.record_consent_decision(
            backend, user_id="u-1", purposes=["memory"],
            status="revoked", context=ConsentContext(),
        )
        await auth_d1.grant_consent_if_undecided(backend, "u-1", ["memory", "cloud_memory"], "test")
        rows = backend.store.tables["privacy_consents"]
        assert [r["purpose"] for r in rows] == ["memory", "cloud_memory"]
        assert (await auth_d1.check_consent(backend, "u-1", "memory")).allowed is False
        assert (await auth_d1.check_consent(backend, "u-1", "cloud_memory")).allowed is True

    async def test_preferences_round_trip(self) -> None:
        backend = Backend()
        prefs = await auth_d1.get_privacy_preferences(backend, "u-9")
        assert prefs.memory_enabled is False
        updated = await auth_d1.update_privacy_preferences(
            backend, "u-9", {"memory_enabled": True}
        )
        assert updated.memory_enabled is True
        assert (await auth_d1.get_privacy_preferences(backend, "u-9")).memory_enabled is True
