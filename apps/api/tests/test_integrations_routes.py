"""Integration REST routes (dashboard contract).

Covers the dashboard-shape API that the frontend (``apps/web``) calls:

- ``GET /api/integrations/status?health=1`` -> {connected, integrations[]}
- ``GET /api/integrations/connect/{id}`` (``?session=`` new-tab auth)
- ``DELETE /api/integrations/{id}`` (native + Composio toolkits)

Native Google providers come from ``mcp_connections``; Composio toolkits from
``composio_connections`` mirror rows. All storage assertions run over an
in-memory fake D1 store with the app's dependencies overridden.
"""

from __future__ import annotations

import re
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from yomi.app import deps
from yomi.app.main import create_app
from yomi.crypto import OAuthTokens, encrypt_tokens
from yomi.db_session import get_db_session
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend
from yomi.services.cloudflare_storage.store import D1Store


class FakeConnectorsStore(D1Store):
    """Minimal in-memory D1 store covering the SQL the integrations routes emit."""

    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {
            "mcp_connections": [],
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
                out.append(
                    {
                        "success": True,
                        "results": [{"id": r["id"]} for r in doomed] if "RETURNING" in sql else [],
                    }
                )
            else:
                raise AssertionError(f"unsupported: {sql}")
        return out

    async def fetch_all(self, sql: str, params: list[Any] | None = None) -> list[dict]:
        p = list(params or [])
        table = re.search(r"FROM (\w+)", sql).group(1)  # type: ignore[union-attr]
        cols = sql.split("SELECT", 1)[1].split("FROM")[0].strip()
        if "WHERE" in sql:
            rows = self._where(table, sql.split("WHERE", 1)[1].split("LIMIT")[0], p)
        else:
            rows = list(self.tables[table])
        if cols == "*":
            return rows
        wanted = [c.strip().split(" ")[0].split(".")[-1] for c in cols.split(",")]
        return [{c: r.get(c) for c in wanted} for r in rows]

    async def fetch_one(self, sql: str, params: list[Any] | None = None) -> dict | None:
        rows = await self.fetch_all(sql, params)
        return rows[0] if rows else None


def _seed_native(store: FakeConnectorsStore, provider: str, tokens: str | None) -> dict:
    row = {
        "id": f"{provider}-id",
        "user_id": "u-9",
        "provider": provider,
        "oauth_tokens": tokens,
        "scopes": [],
        "display_name": None,
        "expires_at": None,
        "updated_at": "2026-01-01T00:00:00Z",
        "last_sync_at": None,
    }
    store.tables["mcp_connections"].append(row)
    return row


def _seed_composio(store: FakeConnectorsStore, toolkit: str, status: str) -> dict:
    row = {
        "id": f"{toolkit}-conn",
        "user_id": "u-9",
        "entity_id": "yomi:u-9",
        "toolkit": toolkit,
        "status": status,
        "alias": f"{toolkit}@example.com",
        "connected_account_id": f"acc-{toolkit}",
        "connected_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
        "last_trigger_event_at": None,
    }
    store.tables["composio_connections"].append(row)
    return row


@pytest.fixture
def env_key(monkeypatch):
    monkeypatch.setattr("yomi.crypto.settings.encryption_key", "a" * 64)
    monkeypatch.setattr("yomi.crypto.settings.encryption_key_fallbacks", "")


def _valid_tokens() -> str:
    return encrypt_tokens(
        OAuthTokens(
            access_token="live-access",
            refresh_token="live-refresh",
            expires_at=4_100_000_000_000,
            token_type="Bearer",
            scope="openid email profile",
        )
    )


class TestNoAuth:
    @pytest.fixture
    def client(self):
        app = create_app()

        async def _fake_db():
            yield object()

        app.dependency_overrides[get_db_session] = _fake_db
        with TestClient(app) as client:
            yield client

    def test_status_requires_auth(self, client):
        assert client.get("/api/integrations/status?health=1").status_code == 401

    def test_connect_requires_auth(self, client):
        assert client.get("/api/integrations/connect/github").status_code == 401

    def test_list_requires_auth(self, client):
        assert client.get("/api/integrations").status_code == 401

    def test_revoke_requires_auth(self, client):
        assert client.delete("/api/integrations/github").status_code == 401


class TestStatus:
    @pytest.fixture
    def d1_client(self):
        app = create_app()
        store = FakeConnectorsStore()

        async def _fake_db():
            yield object()

        async def _fake_d1():
            yield D1Backend(store=store, client=None)

        async def _fake_user():
            return SimpleNamespace(id="u-9")

        app.dependency_overrides[get_db_session] = _fake_db
        app.dependency_overrides[get_d1_backend] = _fake_d1
        app.dependency_overrides[deps.get_current_user] = _fake_user
        app.dependency_overrides[deps.get_current_user_query] = _fake_user
        with TestClient(app) as client:
            yield client, store

    def test_empty_user_has_blank_status(self, d1_client):
        client, _store = d1_client
        body = client.get("/api/integrations/status?health=1").json()
        assert body["connected"] == []
        assert body["integrations"] == []

    def test_native_and_composio_connected(self, d1_client, env_key):
        client, store = d1_client
        _seed_native(store, "google", _valid_tokens())
        _seed_composio(store, "github", "ACTIVE")
        _seed_composio(store, "slack", "INVALID")

        body = client.get("/api/integrations/status?health=1").json()
        assert body["connected"] == ["github", "google"]

        by_provider = {entry["provider"]: entry for entry in body["integrations"]}
        assert by_provider["google"]["healthy"] is True
        assert by_provider["google"]["status"] == "connected"
        assert by_provider["github"]["healthy"] is True
        assert by_provider["github"]["status"] == "connected"
        assert by_provider["github"]["displayName"] == "github@example.com"
        assert "slack" not in by_provider

    def test_composio_google_slugs_map_to_catalog_ids(self, d1_client, env_key):
        client, store = d1_client
        _seed_composio(store, "gmail", "ACTIVE")
        _seed_composio(store, "googlecalendar", "ACTIVE")
        _seed_composio(store, "github", "ACTIVE")
        _seed_composio(store, "slack", "INVALID")

        body = client.get("/api/integrations/status?health=1").json()
        assert body["connected"] == ["github", "google", "google-calendar"]

        by_provider = {entry["provider"]: entry for entry in body["integrations"]}
        assert by_provider["google"]["healthy"] is True
        assert by_provider["google"]["displayName"] == "gmail@example.com"
        assert by_provider["google-calendar"]["status"] == "connected"
        assert "slack" not in by_provider

    def test_corrupt_tokens_flagged_needs_reconnect(self, d1_client, env_key):
        client, store = d1_client
        _seed_native(store, "google", "not-encrypted-tokens")
        _seed_composio(store, "github", "ACTIVE")

        body = client.get("/api/integrations/status?health=1").json()
        by_provider = {entry["provider"]: entry for entry in body["integrations"]}
        assert by_provider["google"]["healthy"] is False
        assert by_provider["google"]["status"] == "needs_reconnect"
        assert by_provider["google"]["message"]
        assert "github" in body["connected"]

    def test_status_pays_no_attention_to_health_param(self, d1_client):
        client, _store = d1_client
        assert client.get("/api/integrations/status").status_code == 200


class TestConnect:
    @pytest.fixture
    def client(self):
        app = create_app()

        async def _fake_db():
            yield object()

        async def _fake_user():
            return SimpleNamespace(id="u-9")

        app.dependency_overrides[get_db_session] = _fake_db
        app.dependency_overrides[deps.get_current_user] = _fake_user
        app.dependency_overrides[deps.get_current_user_query] = _fake_user
        with TestClient(app) as client:
            yield client

    def _composio(self, monkeypatch, connectors="github,slack"):
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_api_key", "test-key")
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_connectors", connectors)

    def test_google_connector_goes_through_composio(self, client, monkeypatch):
        self._composio(monkeypatch, connectors="github,slack,google,google-calendar,google-drive")
        fake_session = _FakeSession(toolkit_states=[])
        monkeypatch.setattr(
            "yomi.connectors.composio.get_composio",
            lambda: _FakeClient(fake_session),
        )
        res = client.get("/api/integrations/connect/google?session=abc", follow_redirects=False)
        assert res.status_code == 302
        assert res.headers["location"] == "https://composio.example/flow/gmail"
        assert res.headers["referrer-policy"] == "no-referrer"
        assert fake_session.callback_urls == ["https://getyomi.in/dashboard?connect=google"]

    def test_google_connector_maps_calendar_slug(self, client, monkeypatch):
        self._composio(monkeypatch, connectors="github,slack,google,google-calendar,google-drive")
        monkeypatch.setattr(
            "yomi.connectors.composio.get_composio",
            lambda: _FakeClient(_FakeSession(toolkit_states=[])),
        )
        res = client.get("/api/integrations/connect/google-calendar")
        assert res.status_code == 200
        assert res.json()["url"] == "https://composio.example/flow/googlecalendar"

    def test_google_connector_already_connected(self, client, monkeypatch):
        self._composio(monkeypatch, connectors="github,slack,google,google-calendar,google-drive")
        monkeypatch.setattr(
            "yomi.connectors.composio.get_composio",
            lambda: _FakeClient(_FakeSession(toolkit_states=[_toolkit("gmail", "ACTIVE")])),
        )
        res = client.get("/api/integrations/connect/google")
        body = res.json()
        assert body["kind"] == "composio"
        assert body["status"] == "connected"
        assert body["url"] is None

    def test_google_connector_unconfigured_404(self, client, monkeypatch):
        self._composio(monkeypatch)
        assert client.get("/api/integrations/connect/google").status_code == 404

    def test_composio_needs_connection(self, client, monkeypatch):
        self._composio(monkeypatch)
        fake_session = _FakeSession(toolkit_states=[])
        monkeypatch.setattr(
            "yomi.connectors.composio.get_composio",
            lambda: _FakeClient(fake_session),
        )
        res = client.get("/api/integrations/connect/github?session=abc", follow_redirects=False)
        assert res.status_code == 302
        assert res.headers["location"] == "https://composio.example/flow/github"
        assert res.headers["referrer-policy"] == "no-referrer"
        assert fake_session.callback_urls == ["https://getyomi.in/dashboard?connect=github"]

    def test_composio_already_connected(self, client, monkeypatch):
        self._composio(monkeypatch)
        monkeypatch.setattr(
            "yomi.connectors.composio.get_composio",
            lambda: _FakeClient(_FakeSession(toolkit_states=[_toolkit("github", "ACTIVE")])),
        )
        res = client.get("/api/integrations/connect/github")
        body = res.json()
        assert body["status"] == "connected"
        assert body["url"] is None

    def test_composio_unconfigured_server_503(self, client, monkeypatch):
        self._composio(monkeypatch)
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_api_key", "")
        assert client.get("/api/integrations/connect/github").status_code == 503

    def test_unknown_and_api_key_connector_404(self, client, monkeypatch):
        self._composio(monkeypatch)
        assert client.get("/api/integrations/connect/does-not-exist").status_code == 404
        assert client.get("/api/integrations/connect/context7").status_code == 404


class TestRevoke:
    @pytest.fixture
    def d1_client(self):
        app = create_app()
        store = FakeConnectorsStore()

        async def _fake_db():
            yield object()

        async def _fake_d1():
            yield D1Backend(store=store, client=None)

        async def _fake_user():
            return SimpleNamespace(id="u-9")

        app.dependency_overrides[get_db_session] = _fake_db
        app.dependency_overrides[get_d1_backend] = _fake_d1
        app.dependency_overrides[deps.get_current_user] = _fake_user
        app.dependency_overrides[deps.get_current_user_query] = _fake_user
        with TestClient(app) as client:
            yield client, store

    def test_revoke_native_google(self, d1_client, env_key, monkeypatch):
        client, store = d1_client
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_connectors", "")
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_api_key", "")
        _seed_native(store, "google", _valid_tokens())
        res = client.delete("/api/integrations/google")
        assert res.status_code == 200
        assert store.tables["mcp_connections"] == []

    def test_revoke_google_delegates_to_composio(self, d1_client, monkeypatch):
        client, store = d1_client
        _seed_composio(store, "gmail", "ACTIVE")
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_api_key", "test-key")
        monkeypatch.setattr(
            "yomi.connectors.composio.settings.composio_connectors",
            "github,slack,google,google-calendar",
        )

        class _Accounts:
            def list(self, **kwargs):
                return SimpleNamespace(items=[])

        class _Client:
            connected_accounts = _Accounts()

        monkeypatch.setattr("yomi.connectors.composio.get_composio", lambda: _Client())

        res = client.delete("/api/integrations/google")
        assert res.status_code == 200
        assert not store.tables["composio_connections"]

    def test_revoke_composio_clears_mirror_without_server(self, d1_client, monkeypatch):
        client, store = d1_client
        _seed_composio(store, "github", "ACTIVE")
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_api_key", "test-key")
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_connectors", "github,slack")
        monkeypatch.setattr("yomi.connectors.composio.get_composio", lambda: None)

        res = client.delete("/api/integrations/github")
        assert res.status_code == 200
        assert not store.tables["composio_connections"]

    def test_revoke_composio_delegates_to_server(self, d1_client, monkeypatch):
        client, store = d1_client
        _seed_composio(store, "github", "ACTIVE")
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_api_key", "test-key")
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_connectors", "github,slack")

        class _Accounts:
            def list(self, **kwargs):
                return SimpleNamespace(items=[])

        class _Client:
            connected_accounts = _Accounts()

        monkeypatch.setattr("yomi.connectors.composio.get_composio", lambda: _Client())

        res = client.delete("/api/integrations/github")
        assert res.status_code == 200
        assert not store.tables["composio_connections"]

    def test_revoke_unknown_is_idempotent(self, d1_client):
        client, _store = d1_client
        assert client.delete("/api/integrations/notaconnector").status_code == 200


# --- Composio SDK doubles (mirror the fixtures used in test_composio.py) ---


class _ComposioConn:
    def __init__(self, status):
        self.status = status


class _ToolkitItem:
    def __init__(self, slug, status):
        self.slug = slug
        self.connection = SimpleNamespace(connectedAccount=_ComposioConn(status))


class _FakeSession:
    def __init__(self, toolkit_states=None):
        self._toolkits = toolkit_states or []
        self.callback_urls = []

    def toolkits(self):
        return SimpleNamespace(items=self._toolkits)

    def tools(self):
        return SimpleNamespace(items=SimpleNamespace(items=[]))

    def authorize(self, toolkit, callback_url=None):
        self.callback_urls.append(callback_url)
        return SimpleNamespace(redirect_url=f"https://composio.example/flow/{toolkit}")


class _FakeClient:
    def __init__(self, session):
        self.session = session

    def create(self, **kwargs):
        return self.session


def _toolkit(slug, status):
    return _ToolkitItem(slug, status)
