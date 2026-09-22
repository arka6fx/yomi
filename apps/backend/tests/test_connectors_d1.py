"""Behavioral tests for the D1 connectors backend over an in-memory fake."""

from __future__ import annotations

import re
import time
from typing import Any

import pytest

from yomi.connectors.base import ConnectorError
from yomi.crypto import OAuthTokens, encrypt_tokens
from yomi.services import connectors_d1
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.store import D1Store


class FakeConnectors(D1Store):
    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {
            "mcp_connections": [],
            "pending_actions": [],
            "platform_connections": [],
            "telegram_link_tokens": [],
            "composio_connections": [],
        }

    def _insert(self, stmt: Statement) -> dict:
        match = re.match(r'INSERT (?:OR \w+ )?INTO "(\w+)" \((.+)\) VALUES', stmt.sql)
        assert match, stmt.sql
        cols = [c.strip().strip('"') for c in match.group(2).split(",")]
        self.tables[match.group(1)].append(dict(zip(cols, stmt.params, strict=True)))
        return {"success": True}

    def _eval(self, row: dict, cond: str, params: list, pos: int) -> tuple[bool, int]:
        cond = cond.strip()
        if cond.startswith("(") and cond.endswith(")"):
            width = cond.count("?")
            offset = pos
            for alt in cond[1:-1].split(" OR "):
                match, _ = self._eval(row, alt, params, offset)
                if match:
                    return True, pos + width
                offset += alt.count("?")
            return False, pos + width
        if m := re.match(r"(\w+) = \?$", cond):
            return row.get(m.group(1)) == params[pos], pos + 1
        raise AssertionError(f"unsupported cond: {cond}")

    def _where(self, table: str, where: str, params: list) -> list[dict]:
        rows = []
        for row in self.tables[table]:
            pos, ok = 0, True
            for cond in [c for c in where.split(" AND ") if c.strip()]:
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
            elif m := re.match(r"(\w+) = '([^']*)'$", part):
                row[m.group(1)] = m.group(2)
            elif m := re.match(r"(\w+) = (\d+)$", part):
                row[m.group(1)] = int(m.group(2))
            elif m := re.match(r"(\w+) = NULL$", part, re.IGNORECASE):
                row[m.group(1)] = None
            else:
                raise AssertionError(f"unsupported set: {part}")
        return pos

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
                doomed_ids = {id(r) for r in doomed}
                self.tables[table] = [r for r in self.tables[table] if id(r) not in doomed_ids]
                out.append({
                    "success": True,
                    "results": [{"id": r["id"]} for r in doomed] if "RETURNING" in sql else [],
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
                out.append({
                    "success": True,
                    "results": [{"id": r.get("id", r.get("token"))} for r in rows],
                })
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
            rows = self._where(table, sql.split("WHERE", 1)[1].split("LIMIT")[0], p)
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
        self.store = FakeConnectors()
        self.client = None


def _set_key(monkeypatch) -> None:
    monkeypatch.setattr("yomi.crypto.settings.encryption_key", "a" * 64)
    monkeypatch.setattr("yomi.crypto.settings.encryption_key_fallbacks", "")


def _cipher(monkeypatch, access: str = "live-token", refresh: str | None = None,
            expires_ms: int | None = None) -> str:
    _set_key(monkeypatch)
    return encrypt_tokens(OAuthTokens(
        access_token=access, refresh_token=refresh, expires_at=expires_ms, scope="a b",
    ))


class TestTokens:
    async def test_round_trip_and_shapes(self, monkeypatch) -> None:
        backend = Backend()
        await connectors_d1.upsert_connection(
            backend, "u-1", "google", _cipher(monkeypatch), scopes=["a", "b"]
        )
        found = await connectors_d1.find_connection(backend, "u-1", "google")
        assert found is not None
        listed = await connectors_d1.list_connections(backend, "u-1")
        assert listed[0]["scopes"] == ["a", "b"] and listed[0]["provider"] == "google"
        assert await connectors_d1.connected_providers(backend, "u-1") == {"google"}
        assert await connectors_d1.get_access_token(backend, "u-1", "google") == "live-token"

    async def test_unconnected_raises(self) -> None:
        backend = Backend()
        with pytest.raises(ConnectorError):
            await connectors_d1.get_access_token(backend, "u-1", "google")

    async def test_google_refresh_persists(self, monkeypatch) -> None:
        backend = Backend()
        _set_key(monkeypatch)
        soon = int(time.time() * 1000) + 10_000
        await connectors_d1.upsert_connection(
            backend, "u-1", "google",
            encrypt_tokens(OAuthTokens(access_token="old", refresh_token="rt", expires_at=soon)),
        )
        refreshed = OAuthTokens(access_token="new", refresh_token="rt",
                                expires_at=int(time.time() * 1000) + 3_600_000)

        async def fake_refresh(_rt: str):
            assert _rt == "rt"
            return refreshed

        monkeypatch.setattr(connectors_d1, "refresh_google_access_token", fake_refresh)
        assert await connectors_d1.get_access_token(backend, "u-1", "google") == "new"
        assert await connectors_d1.get_access_token(backend, "u-1", "google") == "new"

    async def test_delete_connection(self, monkeypatch) -> None:
        backend = Backend()
        await connectors_d1.upsert_connection(backend, "u-1", "google", _cipher(monkeypatch))
        assert await connectors_d1.delete_connection(backend, "u-1", "google") is True
        assert await connectors_d1.delete_connection(backend, "u-1", "google") is False

    async def test_token_provider_callable(self, monkeypatch) -> None:
        backend = Backend()
        await connectors_d1.upsert_connection(backend, "u-1", "google", _cipher(monkeypatch))
        provider = connectors_d1.token_provider(backend)
        assert await provider("u-1", "google") == "live-token"


class TestPendingAndLink:
    async def test_pending_creator_row(self) -> None:
        backend = Backend()
        creator = connectors_d1.create_pending_action(
            backend, user_id="u-1", source_platform="telegram", source_chat_id="c-1"
        )
        res = await creator({
            "connector": "gmail", "action": "send", "risk": "send",
            "title": "Send it", "preview": "hi", "payload": {"to": "a@b.c"},
        })
        assert res["status"] == "pending" and res["id"]
        row = backend.store.tables["pending_actions"][0]
        assert row["source_chat_id"] == "c-1" and row["status"] == "pending"

    async def test_link_flow(self) -> None:
        backend = Backend()
        token = await connectors_d1.create_link_token(backend, "u-1")
        assert token
        await connectors_d1.link_with_code(backend, "telegram", "tg-7", "chat-7", token)
        assert await connectors_d1.resolve_platform_user(
            backend, "telegram", "tg-7", "chat-7") == "u-1"
        # chat-scoped resolution also works
        assert await connectors_d1.resolve_platform_user(
            backend, "telegram", "other", "chat-7") == "u-1"
        assert await connectors_d1.resolve_platform_user(
            backend, "telegram", "nobody", "nowhere") is None
        with pytest.raises(ValueError):
            await connectors_d1.link_with_code(backend, "telegram", "tg-7", "chat-7", token)

    async def test_expired_link_rejected(self) -> None:
        backend = Backend()
        backend.store.tables["telegram_link_tokens"].append({
            "token": "old", "user_id": "u-1",
            "created_at": "2020-01-01T00:00:00+00:00",
            "expires_at": "2020-01-01T00:10:00+00:00", "used": 0, "telegram_user_id": None,
        })
        with pytest.raises(ValueError):
            await connectors_d1.link_with_code(backend, "telegram", "tg-1", "c-1", "old")


class TestComposioMirror:
    def _states(self) -> dict:
        return {
            "slack": {
                "slug": "slack", "status": "ACTIVE", "active": True,
                "connected_account_id": "acc-1", "connected_at": None, "alias": None,
            },
            "github": {
                "slug": "github", "status": "INITIATED", "active": False,
                "connected_account_id": "", "connected_at": None, "alias": None,
            },
        }

    async def test_sync_insert_update_prune(self) -> None:
        backend = Backend()
        await connectors_d1.sync_connections(backend, "u-1", self._states(), {"slack", "github"})
        assert len(backend.store.tables["composio_connections"]) == 2
        states = self._states()
        states["slack"]["status"] = "EXPIRED"
        states["slack"]["active"] = False
        await connectors_d1.sync_connections(backend, "u-1", states, {"slack"})
        rows = {r["toolkit"]: r for r in backend.store.tables["composio_connections"]}
        assert set(rows) == {"slack"} and rows["slack"]["status"] == "EXPIRED"
        listed = await connectors_d1.composio_connection_rows(backend, "u-1")
        assert len(listed) == 1

    async def test_webhook_connection_and_trigger(self) -> None:
        backend = Backend()
        raw = {
            "type": "composio.connected_account.expired",
            "data": {
                "entity_id": "yomi:u-1",
                "toolkit": {"slug": "Slack"},
                "status": "active",
                "status_reason": None,
                "id": "acc-9",
                "connected_at": None,
            },
        }
        res = await connectors_d1.handle_composio_webhook_event(backend, raw, None)
        assert res == {"kind": "connection", "toolkit": "slack", "status": "ACTIVE"}
        trigger_raw = {"type": "composio.trigger.message"}
        normalized = {"user_id": "yomi:u-1", "toolkit_slug": "slack", "trigger_slug": "t-1"}
        res = await connectors_d1.handle_composio_webhook_event(backend, trigger_raw, normalized)
        assert res["kind"] == "trigger"
        row = backend.store.tables["composio_connections"][0]
        assert row["last_trigger_event_at"] is not None
        res = await connectors_d1.handle_composio_webhook_event(backend, {"type": "weird"}, None)
        assert res == {"kind": "unknown", "ignored": True}

    async def test_disconnect_without_client(self, monkeypatch) -> None:
        from yomi.connectors.base import ConnectorError as _ConnectorError

        monkeypatch.setattr(connectors_d1, "get_composio", lambda: None)
        backend = Backend()
        with pytest.raises(_ConnectorError):
            await connectors_d1.disconnect_composio_connection(backend, "u-1", "slack")

    async def test_build_tools_without_key_returns_empty(self) -> None:
        backend = Backend()
        tools, counter = await connectors_d1.build_composio_tools_d1(backend, "u-1", None)
        assert tools == {} and counter() == 0
