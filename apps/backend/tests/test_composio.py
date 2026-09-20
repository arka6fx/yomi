from types import SimpleNamespace

import pytest
from sqlalchemy import Delete

from yomi.connectors.base import PAID, SEND, WRITE
from yomi.connectors.composio import (
    _compiled_parameters,
    _composio_error,
    _risk_for_slug,
    build_composio_tools,
    classify_webhook_event,
    configured_toolkit_ids,
    connection_event_fields,
    disconnect_connection,
    ensure_webhook_subscription,
    get_composio,
    get_connection_url,
    handle_webhook_event,
    parse_webhook,
    resolve_entity_id,
    sync_composio_connections,
    sync_connections,
    trigger_event_fields,
    user_from_entity_id,
    webhook_url,
)
from yomi.db.models_app2 import ComposioConnection
from yomi.services.agent.loop import _charge_composio_usage


class FakeTool:
    def __init__(self, slug, name=None, input_parameters=None, toolkit="slack"):
        self.slug = slug
        self.name = name or slug
        self.human_description = f"Run {slug}"
        self.description = f"auto description for {slug}"
        self.input_parameters = input_parameters
        self.toolkit = SimpleNamespace(slug=toolkit)


class FakeExecution:
    def __init__(self, slug, data=None, error=None, arguments=None):
        self.slug = slug
        self.arguments = arguments
        self.data = data
        self.error = error


class FakeSession:
    def __init__(self, user_id=None, tools=None, toolkit_states=None, execute=None):
        self.created_for = user_id
        self._tools = tools or []
        self._toolkits = toolkit_states or []
        self._execute = execute
        self.execution = FakeExecution(None)

    def tools(self):
        return SimpleNamespace(items=SimpleNamespace(items=self._tools))

    def toolkits(self):
        return SimpleNamespace(items=self._toolkits)

    def execute(self, slug, arguments=None):
        self.execution = FakeExecution(slug, arguments=arguments)
        if self._execute:
            return self._execute(slug, arguments)
        if slug.startswith("fail"):
            return FakeExecution(slug, error="connection for this app has expired (401)")
        return FakeExecution(slug, data={"ok": True, "slug": slug})

    def authorize(self, toolkit, callback_url=None):
        return SimpleNamespace(redirect_url=f"https://composio.example/flow/{toolkit}")


class FakeClient:
    def __init__(self, session=None):
        self.sessions = []
        self.session = session or FakeSession()

    def create(self, **kwargs):
        self.sessions.append(kwargs)
        self.session.created_for = kwargs.get("user_id")
        return self.session


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr("yomi.connectors.composio.settings.composio_api_key", "test-key")
    monkeypatch.setattr("yomi.connectors.composio.settings.composio_connectors", "slack,github")
    return None


def _toolkit_state(slug, status):
    return SimpleNamespace(
        slug=slug,
        connection=None if status is None else SimpleNamespace(
            connectedAccount=SimpleNamespace(status=status)
        ),
    )


def _session(client, **kwargs):
    session = FakeSession(**kwargs)
    client.session = session
    return session


class TestConfig:
    def test_entity_is_namespaced(self):
        assert resolve_entity_id("u-42") == "yomi:u-42"

    def test_configured_drops_first_class(self, configured, monkeypatch):
        monkeypatch.setattr(
            "yomi.connectors.composio.settings.composio_connectors",
            "google,slack,gitlab,google-drive",
        )
        assert configured_toolkit_ids() == {"slack", "gitlab"}

    def test_unconfigured_server_returns_no_composio(self, monkeypatch):
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_api_key", "")
        assert get_composio() is None


class TestBuildTools:
    @pytest.mark.asyncio
    async def test_no_key_returns_empty(self, monkeypatch):
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_api_key", "")
        registry, counter = await build_composio_tools("u-1")
        assert registry == {}
        assert counter() == 0

    @pytest.mark.asyncio
    async def test_no_configured_connectors_returns_empty(self, monkeypatch):
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_api_key", "key")
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_connectors", "")
        registry, counter = await build_composio_tools("u-1")
        assert registry == {}
        assert counter() == 0

    @pytest.mark.asyncio
    async def test_only_active_toolkits_surface_tools(self, configured, monkeypatch):
        states = [
            _toolkit_state("slack", "ACTIVE"),
            _toolkit_state("github", "INVALID"),
            _toolkit_state("missing", "ACTIVE"),
        ]
        tools = [
            FakeTool("slack_listChannels", "List channels"),
            FakeTool("slack_postMessage", "Post message"),
            FakeTool("github_getRepo", "Get repo", toolkit="github"),
        ]
        session = FakeSession(tools=tools, toolkit_states=states)
        client = FakeClient(session)
        monkeypatch.setattr("yomi.connectors.composio.get_composio", lambda: client)

        registry, counter = await build_composio_tools("u-1")
        assert client.sessions[0]["user_id"] == "yomi:u-1"
        assert set(registry) == {"slack_listChannels", "slack_postMessage"}
        assert counter() == 0

    @pytest.mark.asyncio
    async def test_execute_returns_data_and_counts(self, configured, monkeypatch):
        session = FakeSession(
            tools=[
                FakeTool("slack_fooReadSync", "Read foo"),
                FakeTool("slack_barRead", "Read bar"),
            ],
            toolkit_states=[_toolkit_state("slack", "ACTIVE")],
        )
        client = FakeClient(session)
        monkeypatch.setattr("yomi.connectors.composio.get_composio", lambda: client)

        registry, counter = await build_composio_tools("u-1")
        tool = registry["slack_fooReadSync"]
        result = await tool.execute({"channel": "C123"})
        assert result == {"ok": True, "slug": "slack_fooReadSync"}
        assert session.execution.arguments == {"channel": "C123"}
        assert counter() == 1

    @pytest.mark.asyncio
    async def test_write_slug_gates_via_hook(self, configured, monkeypatch):
        pending = {}

        async def hook(meta):
            pending.update(meta)
            return {"status": "pending", "id": "p-1"}

        session = FakeSession(
            tools=[FakeTool("slack_postMessage", "Post message")],
            toolkit_states=[_toolkit_state("slack", "ACTIVE")],
        )
        client = FakeClient(session)
        monkeypatch.setattr("yomi.connectors.composio.get_composio", lambda: client)

        registry, counter = await build_composio_tools("u-1", hook)
        tool = registry["slack_postMessage"]
        result = await tool.execute({"channel": "C1", "text": "hi"})
        assert result["status"] == "pending"
        assert pending["connector"] == "composio"
        assert pending["risk"] == SEND
        assert pending["payload"] == {"channel": "C1", "text": "hi"}
        assert session.execution.slug is None
        assert counter() == 0

    @pytest.mark.asyncio
    async def test_read_slug_runs_without_hook(self, configured, monkeypatch):
        session = FakeSession(
            tools=[FakeTool("slack_listChannels", "List channels")],
            toolkit_states=[_toolkit_state("slack", "ACTIVE")],
        )
        client = FakeClient(session)
        monkeypatch.setattr("yomi.connectors.composio.get_composio", lambda: client)

        registry, counter = await build_composio_tools("u-1", None)
        result = await registry["slack_listChannels"].execute({"cursor": None})
        assert result["ok"] is True
        assert counter() == 1

    @pytest.mark.asyncio
    async def test_connection_lookup_failure_is_silent(self, configured, monkeypatch):
        class BrokenSession:
            def tools(self):
                raise RuntimeError("nope")

            def toolkits(self):
                raise RuntimeError("sd.crashed")

            def execute(self, *a, **k):
                raise AssertionError("should not execute")

        client = FakeClient(BrokenSession())
        monkeypatch.setattr("yomi.connectors.composio.get_composio", lambda: client)
        registry, counter = await build_composio_tools("u-1")
        assert registry == {}
        assert counter() == 0

    @pytest.mark.asyncio
    async def test_error_is_mapped_to_reconnect_hint(self, configured, monkeypatch):
        session = FakeSession(
            tools=[FakeTool("fail_madeUpSync", "Explode")],
            toolkit_states=[_toolkit_state("slack", "ACTIVE")],
        )
        client = FakeClient(session)
        monkeypatch.setattr("yomi.connectors.composio.get_composio", lambda: client)

        registry, counter = await build_composio_tools("u-1")
        result = await registry["fail_madeUpSync"].execute({})
        assert result["error"]
        assert "re-connect" in result["hint"]
        assert counter() == 1


class TestConnectionUrl:
    @pytest.mark.asyncio
    async def test_returns_redirect(self, configured, monkeypatch):
        client = FakeClient()
        monkeypatch.setattr("yomi.connectors.composio.get_composio", lambda: client)
        url = await get_connection_url("u-1", "slack", "https://getyomi.in/dashboard")
        assert url == "https://composio.example/flow/slack"
        assert client.sessions[0]["user_id"] == "yomi:u-1"
        assert client.session.created_for == "yomi:u-1"

    @pytest.mark.asyncio
    async def test_unconfigured_raises(self, monkeypatch):
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_api_key", "")
        from yomi.connectors.base import ConnectorError

        with pytest.raises(ConnectorError):
            await get_connection_url("u-1", "slack")


class TestModuleHelpers:
    def test_risk_classification(self):
        assert _risk_for_slug("slack_listChannels") is None
        assert _risk_for_slug("slack_postMessage") == SEND
        assert _risk_for_slug("google-docs_createDoc") == WRITE
        assert _risk_for_slug("stripe_createCheckoutSession") == PAID

    def test_compiled_parameters_preserves_schema(self):
        raw = {"type": "object", "properties": {"channel": {"type": "string"}}}
        assert _compiled_parameters(raw)["properties"] == {"channel": {"type": "string"}}

    def test_compiled_parameters_empty_for_missing(self):
        assert _compiled_parameters(None) == {"type": "object", "properties": {}}

    def test_composio_error_maps_expired_connection(self, monkeypatch):
        monkeypatch.setattr("yomi.connectors.composio.settings.app_url", "https://getyomi.in")
        out = _composio_error("Exception: Connection for this app has expired (401).")
        assert "re-connect" in out["hint"]

    def test_composio_error_unknown_has_no_hint(self):
        out = _composio_error("Some generic server error")
        assert "hint" not in out


class TestCharging:
    @pytest.mark.asyncio
    async def test_charges_per_successful_composio_call(self, monkeypatch):
        charged = {}

        async def fake_charge(db, entry):
            charged.update({"kind": entry.kind, "units": entry.units})

        monkeypatch.setattr("yomi.services.agent.loop.charge_usage", fake_charge)

        class FakeActive:
            def composio_calls(self):
                return 3

        await _charge_composio_usage(None, FakeActive(), "u-1", "max")
        assert charged == {"kind": "composio_tool", "units": 3}

    @pytest.mark.asyncio
    async def test_no_counter_is_noop(self, monkeypatch):
        called = []

        async def fake_charge(db, entry):
            called.append(entry)

        monkeypatch.setattr("yomi.services.agent.loop.charge_usage", fake_charge)
        await _charge_composio_usage(None, object(), "u-1", "max")
        assert called == []

    @pytest.mark.asyncio
    async def test_zero_calls_charges_nothing(self, monkeypatch):
        called = []

        async def fake_charge(db, entry):
            called.append(entry)

        monkeypatch.setattr("yomi.services.agent.loop.charge_usage", fake_charge)

        class FakeActive:
            def composio_calls(self):
                return 0

        await _charge_composio_usage(None, FakeActive(), "u-1", "max")
        assert called == []


class FakeTriggers:
    def __init__(self):
        self.subscribed = None
        self.parse_kwargs = None

    def set_webhook_subscription(self, **kwargs):
        self.subscribed = kwargs
        return SimpleNamespace(
            webhook_url=kwargs["webhook_url"],
            version=1,
            enabled_events=kwargs["enabled_events"],
        )

    def parse(self, **kwargs):
        self.parse_kwargs = kwargs
        return {
            "raw_payload": {"type": "composio.trigger.message", "data": {}},
            "payload": {"trigger_slug": "slack_message_received"},
        }


class FakeConnAccounts:
    def __init__(self, accounts=None):
        self.accounts = accounts or [SimpleNamespace(id="acc-9")]
        self.listed = None
        self.deleted = []

    def list(self, **kwargs):
        self.listed = kwargs
        return SimpleNamespace(items=self.accounts)

    def delete(self, account_id, revoke_on_delete=True):
        self.deleted.append((account_id, revoke_on_delete))


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None


class FakeDB:
    def __init__(self):
        self.rows = []

    async def execute(self, stmt):
        criteria = list(getattr(stmt, "_where_criteria", []) or [])
        if isinstance(stmt, Delete):
            matched = self._match(criteria)
            self.rows = [r for r in self.rows if r not in matched]
            return FakeResult([])
        return FakeResult(self._match(criteria))

    def _match(self, criteria):
        out = list(self.rows)
        for crit in criteria:
            key = getattr(getattr(crit, "left", None), "key", None)
            right = getattr(crit, "right", None)
            right = getattr(right, "value", right)
            if key:
                out = [r for r in out if getattr(r, key) == right]
        return out

    def add(self, row):
        self.rows.append(row)

    async def delete(self, row):
        if row in self.rows:
            self.rows.remove(row)

    async def flush(self):
        pass


class TestWebhookClassification:
    def test_connection_event(self):
        event = "composio.connected_account.expired"
        assert classify_webhook_event({"type": event}) == "connection"
        assert classify_webhook_event({"type": "composio.connection.active"}) == "connection"

    def test_trigger_event(self):
        assert classify_webhook_event({"type": "composio.trigger.message"}) == "trigger"
        assert classify_webhook_event({"trigger_name": "slack_message"}) == "trigger"

    def test_unknown(self):
        assert classify_webhook_event({}) == "unknown"
        assert classify_webhook_event(None) == "unknown"
        assert classify_webhook_event({"type": "cloudflare.webhook"}) == "unknown"

    def test_connection_event_fields(self):
        raw = {
            "data": {
                "entity_id": "yomi:u-1",
                "toolkit": {"slug": "slack"},
                "status": "EXPIRED",
                "status_reason": "oauth2 token expired",
                "id": "acc-1",
            }
        }
        fields = connection_event_fields(raw)
        assert fields == {
            "entity_id": "yomi:u-1",
            "toolkit": "slack",
            "status": "EXPIRED",
            "status_reason": "oauth2 token expired",
            "connected_account_id": "acc-1",
            "connected_at": None,
        }

    def test_connection_event_fields_missing_data(self):
        assert connection_event_fields({}) is None
        assert connection_event_fields({"data": {"toolkit": {"slug": "slack"}}}) is None

    def test_trigger_event_fields_and_fallback(self):
        out = trigger_event_fields(
            {"user_id": "yomi:u-1", "toolkit_slug": "slack", "trigger_slug": "msg"}
        )
        assert out == {"user_id": "yomi:u-1", "toolkit": "slack", "trigger_slug": "msg"}

        out = trigger_event_fields(
            {
                "metadata": {
                    "connected_account": {"user_id": "yomi:u-2", "toolkit_slug": "github"}
                }
            }
        )
        assert out["user_id"] == "yomi:u-2"

    def test_trigger_event_fields_missing(self):
        assert trigger_event_fields({}) == {"user_id": "", "toolkit": "", "trigger_slug": ""}

    def test_entity_roundtrip(self):
        assert user_from_entity_id("yomi:u-1") == "u-1"
        assert user_from_entity_id("foreign:xyz") is None
        assert user_from_entity_id(None) is None
        assert user_from_entity_id("u-1") == "u-1"


class TestSyncConnections:
    @pytest.mark.asyncio
    async def test_upserts_rows_from_states(self):
        db = FakeDB()
        states = {
            "slack": {
                "slug": "slack",
                "status": "ACTIVE",
                "active": True,
                "connected_account_id": "acc-1",
                "connected_at": None,
                "alias": "work",
            }
        }
        await sync_connections(db, "u-1", states, {"slack"})
        assert len(db.rows) == 1
        row = db.rows[0]
        assert row.toolkit == "slack"
        assert row.entity_id == "yomi:u-1"
        assert row.status == "ACTIVE"
        assert row.connected_account_id == "acc-1"
        assert row.alias == "work"
        assert row.connected_at is not None

    @pytest.mark.asyncio
    async def test_updates_existing_rows_in_place(self):
        db = FakeDB()
        db.rows.append(
            ComposioConnection(user_id="u-1", entity_id="yomi:u-1", toolkit="slack")
        )
        states = {
            "slack": {
                "slug": "slack",
                "status": "EXPIRED",
                "active": False,
                "connected_account_id": "",
                "connected_at": None,
                "alias": None,
            }
        }
        await sync_connections(db, "u-1", states, {"slack"})
        assert len(db.rows) == 1
        assert db.rows[0].status == "EXPIRED"

    @pytest.mark.asyncio
    async def test_prunes_unconfigured_toolkits(self):
        db = FakeDB()
        db.rows.append(
            ComposioConnection(user_id="u-1", entity_id="yomi:u-1", toolkit="stale")
        )
        await sync_connections(db, "u-1", {}, {"slack"})
        assert db.rows == []

    @pytest.mark.asyncio
    async def test_sync_composio_connections_refreshes_from_client(self, configured, monkeypatch):
        session = FakeSession(toolkit_states=[_toolkit_state("slack", "ACTIVE")])
        client = FakeClient(session)
        monkeypatch.setattr("yomi.connectors.composio.get_composio", lambda: client)
        db = FakeDB()

        states = await sync_composio_connections(db, "u-1")
        assert states["slack"]["active"] is True
        assert db.rows[0].toolkit == "slack"

    @pytest.mark.asyncio
    async def test_sync_without_key_is_noop(self, monkeypatch):
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_api_key", "")
        db = FakeDB()
        assert await sync_composio_connections(db, "u-1") == {}
        assert db.rows == []


class TestWebhookHandler:
    def _expired_raw(self, entity="yomi:u-1", slug="slack", status="EXPIRED"):
        return {
            "id": "evt-1",
            "type": "composio.connected_account.expired",
            "data": {
                "entity_id": entity,
                "toolkit": {"slug": slug},
                "status": status,
                "status_reason": "oauth2 token expired",
                "id": "acc-2",
            },
        }

    @pytest.mark.asyncio
    async def test_connection_event_updates_row(self):
        db = FakeDB()
        db.rows.append(
            ComposioConnection(user_id="u-1", entity_id="yomi:u-1", toolkit="slack")
        )
        result = await handle_webhook_event(db, self._expired_raw())
        assert result["kind"] == "connection"
        assert result["status"] == "EXPIRED"
        assert db.rows[0].status == "EXPIRED"
        assert db.rows[0].status_reason == "oauth2 token expired"
        assert db.rows[0].connected_account_id == "acc-2"

    @pytest.mark.asyncio
    async def test_connection_event_creates_row(self):
        db = FakeDB()
        result = await handle_webhook_event(db, self._expired_raw())
        assert result["kind"] == "connection"
        assert len(db.rows) == 1
        assert db.rows[0].toolkit == "slack"
        assert db.rows[0].user_id == "u-1"

    @pytest.mark.asyncio
    async def test_connection_event_unknown_entity_ignored(self):
        db = FakeDB()
        result = await handle_webhook_event(db, self._expired_raw(entity="acme:other"))
        assert result == {"kind": "connection", "ignored": True}
        assert db.rows == []

    @pytest.mark.asyncio
    async def test_trigger_event_records_timestamp_only(self):
        db = FakeDB()
        row = ComposioConnection(user_id="u-1", entity_id="yomi:u-1", toolkit="slack")
        db.rows.append(row)
        raw = {"type": "composio.trigger.message", "data": {"secret": "pii"}}
        normalized = {"user_id": "yomi:u-1", "toolkit_slug": "slack", "trigger_slug": "msg"}
        result = await handle_webhook_event(db, raw, normalized)
        assert result["kind"] == "trigger"
        assert row.last_trigger_event_at is not None
        assert row.toolkit == "slack"

    @pytest.mark.asyncio
    async def test_trigger_event_without_row_ignored(self):
        db = FakeDB()
        normalized = {"user_id": "yomi:u-1", "toolkit_slug": "slack", "trigger_slug": "msg"}
        result = await handle_webhook_event(db, {"type": "composio.trigger.message"}, normalized)
        assert result["kind"] == "trigger"
        assert db.rows == []

    @pytest.mark.asyncio
    async def test_unknown_event_ignored(self):
        db = FakeDB()
        result = await handle_webhook_event(db, {"type": "cloudflare.webhook"})
        assert result == {"kind": "unknown", "ignored": True}


class TestParseWebhook:
    @pytest.mark.asyncio
    async def test_parse_with_secret(self, configured, monkeypatch):
        triggers = FakeTriggers()
        client = FakeClient()
        client.triggers = triggers
        monkeypatch.setattr("yomi.connectors.composio.get_composio", lambda: client)

        parsed = await parse_webhook(b"{}", {}, verify_secret="s3cret")
        assert triggers.parse_kwargs["verify_secret"] == "s3cret"
        assert parsed["raw_payload"]["type"] == "composio.trigger.message"

    @pytest.mark.asyncio
    async def test_parse_without_secret_drops_param(self, configured, monkeypatch):
        triggers = FakeTriggers()
        client = FakeClient()
        client.triggers = triggers
        monkeypatch.setattr("yomi.connectors.composio.get_composio", lambda: client)

        await parse_webhook(b"{}", {}, verify_secret=None)
        assert "verify_secret" not in triggers.parse_kwargs

    @pytest.mark.asyncio
    async def test_parse_unconfigured_raises(self, monkeypatch):
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_api_key", "")
        from yomi.connectors.base import ConnectorError

        with pytest.raises(ConnectorError):
            await parse_webhook(b"{}", {}, verify_secret=None)


class TestDisconnect:
    @pytest.mark.asyncio
    async def test_disconnect_revokes_and_removes_local(self, configured, monkeypatch):
        client = FakeClient()
        conn_accounts = FakeConnAccounts()
        client.connected_accounts = conn_accounts
        monkeypatch.setattr("yomi.connectors.composio.get_composio", lambda: client)
        db = FakeDB()
        db.rows.append(
            ComposioConnection(user_id="u-1", entity_id="yomi:u-1", toolkit="slack")
        )

        result = await disconnect_connection(db, "u-1", "slack")
        assert result == {"disconnected": True, "toolkit": "slack"}
        assert conn_accounts.listed == {"user_ids": ["yomi:u-1"], "toolkit_slugs": ["slack"]}
        assert conn_accounts.deleted == [("acc-9", True)]
        assert db.rows == []

    @pytest.mark.asyncio
    async def test_disconnect_absent_account_is_idempotent(self, configured, monkeypatch):
        client = FakeClient()
        client.connected_accounts = FakeConnAccounts(accounts=[])
        monkeypatch.setattr("yomi.connectors.composio.get_composio", lambda: client)
        db = FakeDB()
        db.rows.append(
            ComposioConnection(user_id="u-1", entity_id="yomi:u-1", toolkit="slack")
        )

        result = await disconnect_connection(db, "u-1", "slack")
        assert result["disconnected"] is True
        assert db.rows == []


class TestWebhookSubscription:
    def test_webhook_url_default(self, monkeypatch):
        monkeypatch.setattr("yomi.connectors.composio.settings.backend_url", "https://api.example.com")
        assert webhook_url() == "https://api.example.com/api/webhooks/composio"

    def test_webhook_url_override(self, monkeypatch):
        monkeypatch.setattr(
            "yomi.connectors.composio.settings.composio_webhook_url", "https://hooks.example/x"
        )
        assert webhook_url() == "https://hooks.example/x"

    @pytest.mark.asyncio
    async def test_subscribes_enabled_events(self, configured, monkeypatch):
        triggers = FakeTriggers()
        client = FakeClient()
        client.triggers = triggers
        monkeypatch.setattr("yomi.connectors.composio.get_composio", lambda: client)
        monkeypatch.setattr("yomi.connectors.composio.settings.backend_url", "https://api.example.com")

        result = await ensure_webhook_subscription()
        assert result["webhook_url"] == "https://api.example.com/api/webhooks/composio"
        assert set(triggers.subscribed["enabled_events"]) == {
            "composio.trigger.message",
            "composio.trigger.disabled",
            "composio.connected_account.expired",
        }

    @pytest.mark.asyncio
    async def test_subscription_without_key_is_noop(self, monkeypatch):
        monkeypatch.setattr("yomi.connectors.composio.settings.composio_api_key", "")
        assert await ensure_webhook_subscription() is None