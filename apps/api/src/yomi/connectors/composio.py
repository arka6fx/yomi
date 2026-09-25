"""Composio-backed connectors.

Composio hosts OAuth + tool execution for the long tail of integrations the
first-class connectors don't implement in-repo (HubSpot, Salesforce,
Discord, LinkedIn, Outlook, Teams, OneDrive, Dropbox, Figma, YouTube, Zoom,
Stripe, Google Docs/Sheets/Slides, ...). We never see user tokens — connections
are per end user (a Composio "entity") and resolve through `COMPOSIO_API_KEY`.

Current SDK pattern (generation B) — confirmed against composio 0.21.x:
    composio = Composio(api_key=settings.composio_api_key)
    session  = composio.create(user_id=entity_id, toolkits=[...])
    tool_items      = composio.tools.get_raw_composio_tools(toolkits=[...])  # slug/name/input_parameters
    toolkit_states  = session.toolkits()       # per-toolkit connection status
    result          = session.execute(slug, arguments=...)  # SessionExecuteResponse(data, error, log_id)
    request         = session.authorize(toolkit, callback_url=...)  # -> redirect_url
    sub             = composio.triggers.set_webhook_subscription(webhook_url=...)  # one per project

Rule from the SDK upgrade checklist: NEVER guess action param names — schemas are
fetched at runtime from the tool items' `input_parameters`. Everything here is
inert until `settings.composio_api_key` is set; the SDK import is lazy so a
backend without the key never pays for the dependency.

Destructive tools (send / delete / pay / post / push ...) run through
`gate_write`, mirroring the first-class connectors: create an approval row when
the host provides a `create_pending_action` hook, otherwise run immediately.

Per-user connection state is mirrored into `composio_connections`: refreshed on
tool build / connect, and kept current by the Composio webhook
(`POST /api/webhooks/composio`, signature-verified via `triggers.parse`). The
webhook also receives trigger messages; those only bump
`last_trigger_event_at` — trigger payloads are not persisted (PII). Disconnect
deletes the Composio connected account and the local mirror row.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.conf import settings
from yomi.connectors.base import (
    IRREVERSIBLE,
    PAID,
    SEND,
    WRITE,
    ConnectorContext,
    ConnectorError,
    ConnectorTool,
    gate_write,
)
from yomi.db.models_app2 import ComposioConnection

logger = logging.getLogger(__name__)

# Composio toolkit slugs differ from the UI catalog ids for the
# Google family (hyphenated catalog ids vs Composio's concatenated/underscored
# slugs). Everything else maps id -> slug unchanged.
_TOOLKIT_SLUG_BY_ID: dict[str, str] = {
    "google": "gmail",
    "google-calendar": "googlecalendar",
    "google-drive": "googledrive",
    "google-docs": "googledocs",
    "google-sheets": "googlesheets",
    "google-slides": "googleslides",
    "google-meet": "googlemeet",
    "google-maps": "google_maps",
    "google-classroom": "google_classroom",
    "google-tasks": "googletasks",
    "google-ads": "googleads",
    "google-analytics": "google_analytics",
    "google-search-console": "google_search_console",
    "google-cloud-vision": "google_cloud_vision",
}
_SLUG_TO_CATALOG_ID: dict[str, str] = {
    slug: connector_id for connector_id, slug in _TOOLKIT_SLUG_BY_ID.items()
}


def toolkit_slug_for_connector(connector_id: str) -> str:
    """Composio toolkit slug for a UI catalog id (identity otherwise)."""
    return _TOOLKIT_SLUG_BY_ID.get(connector_id, connector_id)


def connector_id_for_toolkit(toolkit_slug: str) -> str:
    """UI catalog id for a Composio toolkit slug (identity otherwise)."""
    return _SLUG_TO_CATALOG_ID.get(toolkit_slug, toolkit_slug)


# Composio webhook event types we subscribe to (WebhookEventType values).
_WEBHOOK_CONNECTION_EVENT = "composio.connected_account.expired"
_WEBHOOK_TRIGGER_EVENT = "composio.trigger.message"
_WEBHOOK_TRIGGER_DISABLED_EVENT = "composio.trigger.disabled"
_WEBHOOK_ENABLED_EVENTS = [
    _WEBHOOK_TRIGGER_EVENT,
    _WEBHOOK_TRIGGER_DISABLED_EVENT,
    _WEBHOOK_CONNECTION_EVENT,
]

_ANY = object()


def _attr(obj: Any, name: str, default: Any = _ANY) -> Any:
    """Read a field off a dynamic SDK model or plain dict."""
    if obj is not None and not isinstance(obj, list):
        try:
            value = getattr(obj, name, None)
        except Exception:
            value = None
        if value is not None:
            return value
    if isinstance(obj, dict) and name in obj:
        return obj[name]
    return default


def _noop_counter() -> int:
    return 0


async def _never_tokens(user_id: str, provider: str) -> str:
    raise ConnectorError("Composio connectors resolve tokens server-side")


def configured_toolkit_ids() -> set[str]:
    """Composio toolkit slugs for every configured connector id."""
    return {toolkit_slug_for_connector(c) for c in settings.composio_connector_ids()}


def resolve_entity_id(user_id: str) -> str:
    """One stable Composio entity per end user; namespaced so it never collides."""
    return f"yomi:{user_id}"


def user_from_entity_id(entity_id: str | None) -> str | None:
    """Inverse of `resolve_entity_id`; None when the id isn't one of ours."""
    if not isinstance(entity_id, str) or not entity_id:
        return None
    if entity_id.startswith("yomi:"):
        return entity_id[len("yomi:") :]
    if ":" in entity_id:
        return None
    return entity_id


def webhook_url() -> str:
    """Endpoint Composio should POST events to (overridable via settings)."""
    configured = settings.composio_webhook_url
    if configured:
        return configured
    return f"{settings.backend_url.rstrip('/')}/api/webhooks/composio"


_composio_instance: Any = None


def get_composio() -> Any | None:
    """Lazy Composio client singleton; None when the server has no API key."""
    global _composio_instance
    if not settings.composio_api_key:
        return None
    if _composio_instance is None:
        from composio import Composio

        _composio_instance = Composio(api_key=settings.composio_api_key)
    return _composio_instance


def _connection_active(connection: Any) -> bool:
    """A toolkit connection is usable only when its account is ACTIVE."""
    if connection is None:
        return False
    active = _attr(connection, "isActive", None)
    if active is True:
        return True
    if active is False:
        return False
    account = _account_of(connection)
    status = _attr(account, "status", None)
    return isinstance(status, str) and status.upper() == "ACTIVE"


def _account_of(connection: Any) -> Any:
    if connection is None:
        return None
    return _attr(connection, "connectedAccount", None) or _attr(
        connection, "connected_account", None
    )


def _toolkit_slug(item: Any) -> str:
    toolkit = _attr(item, "toolkit", None)
    slug = _attr(toolkit, "slug", None)
    return str(slug).lower() if slug else ""


def _toolkit_state_map(details: Any) -> dict[str, dict[str, Any]]:
    """Snapshot of per-toolkit connection state from a `session.toolkits()` result."""
    states: dict[str, dict[str, Any]] = {}
    for item in _attr(details, "items", None) or []:
        slug = str(_attr(item, "slug", "") or "").lower()
        if not slug:
            continue
        connection = _attr(item, "connection", None)
        account = _account_of(connection)
        status = _attr(account, "status", None)
        if not isinstance(status, str) or not status:
            status = "ACTIVE" if _connection_active(connection) else "INITIATED"
        states[slug] = {
            "slug": slug,
            "status": status.upper(),
            "active": _connection_active(connection),
            "connected_account_id": str(
                _attr(account, "id", None) or _attr(account, "uuid", "") or ""
            ),
            "connected_at": _attr(account, "connected_at", None),
            "alias": str(_attr(account, "alias", "") or "") or None,
        }
    return states


def _coerce_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _compiled_parameters(raw: Any) -> dict:
    """Normalize a tool's input_parameters JSON schema into an OpenAI schema."""
    if isinstance(raw, dict) and raw:
        schema = dict(raw)
        schema.setdefault("type", "object")
        schema.setdefault("properties", {})
        return {"type": "object", "properties": schema.get("properties") or {}}
    return {"type": "object", "properties": {}}


def _risk_for_slug(slug: str) -> str | None:
    """Classify an action slug by destructiveness for write-gating. None == read."""
    upper = slug.upper()
    if re.search(r"DELETE|REMOVE|REVOKE|UNLINK|TRASH|PERMANENT|DISCONNECT", upper):
        return IRREVERSIBLE
    if re.search(r"PAY|PURCHASE|CHECKOUT|BUY|PLAN|SUBSCRIPTION|BILL|REFUND", upper):
        return PAID
    if re.search(r"SEND|SHARE|PUBLISH|POST|COMMENT|REPLY|INVITE|MESSAGE|BROADCAST|REMIND", upper):
        return SEND
    if re.search(
        r"CREATE|UPDATE|EDIT|MODIFY|WRITE|APPEND|UPLOAD|COMMIT|PUSH|MERGE|STAR|FOLLOW|SCHEDULE",
        upper,
    ):
        return WRITE
    return None


def _item_slug(item: Any) -> str:
    return str(_attr(item, "slug", None) or _attr(item, "name", "") or "")


def _is_deprecated(item: Any) -> bool:
    if _attr(item, "is_deprecated", None) is True:
        return True
    deprecated = _attr(item, "deprecated", None)
    return _attr(deprecated, "is_deprecated", None) is True


# Tool-selection priority for the per-app cap: reads and diagnostics first, then
# everything else alphabetically. Tokens are matched on word boundaries so
# ``MESSAGE`` never reads as ``ME``. Earlier = preferred.
_READ_TOKENS: tuple[str, ...] = (
    "ME",
    "PROFILE",
    "SEARCH",
    "LIST",
    "READ",
    "GET",
    "VIEW",
    "EXPORT",
)


def _tool_priority(slug: str) -> tuple[int, str]:
    """Sort key; lower tuple = surfaced first under a trimmed tool budget."""
    upper = slug.upper()
    for rank, token in enumerate(_READ_TOKENS):
        if re.search(rf"\b{token}\b", upper):
            return rank, upper
    return len(_READ_TOKENS), upper


def _composio_error(err: Any) -> dict[str, str]:
    msg = str(err)
    low = msg.lower()
    if re.search(
        r"connection.{0,12}expired|not connected|no connected account|401|unauthenticated|invalid.?grant|revoked",
        low,
    ):
        return {
            "error": msg,
            "hint": (
                f"The connection to this app is missing or expired — re-connect it in the "
                f"Integrations tab ({settings.app_url}/dashboard)."
            ),
        }
    if re.search(r"rate.?limit|429|too many requests", low):
        return {
            "error": msg,
            "hint": "Composio is rate-limiting this app — wait a bit before retrying.",
        }
    if re.search(r"invalid.?parameter|argument|schema|required", low):
        return {
            "error": msg,
            "hint": "Composio rejected one or more tool arguments — check the tool's schema and adjust the call.",
        }
    if re.search(r"api.?key|invalid.{0,6}key", low):
        return {"error": msg, "hint": "The server is missing a valid COMPOSIO_API_KEY."}
    return {"error": msg}


def _gate_meta(slug: str, display: str, risk: str, args: dict) -> dict:
    preview = json.dumps(args, default=str)
    return {
        "connector": "composio",
        "action": slug,
        "risk": risk,
        "title": f"Composio action: {display}",
        "preview": preview[:500],
        "confirm_text": f"Run {slug}",
    }


async def fetch_toolkit_states(session: Any) -> dict[str, dict[str, Any]]:
    """All per-toolkit connection states on the session (active or not)."""
    details = await asyncio.to_thread(session.toolkits)
    return _toolkit_state_map(details)


async def connected_toolkit_ids(session: Any, configured: set[str] | None = None) -> set[str]:
    """Toolkits on the session with an ACTIVE connected account."""
    states = await fetch_toolkit_states(session)
    connected = {slug for slug, state in states.items() if state["active"]}
    if configured is not None:
        connected &= configured
    return connected


async def fetch_tool_items(client: Any, toolkits: list[str]) -> list[Any]:
    """Tool schemas for the given toolkit slugs (raw Composio `Item` objects).

    NOTE: `session.tools()` returns only the six ToolServer meta tools in this
    SDK generation — real app tools come from
    ``client.tools.get_raw_composio_tools(toolkits=...)``. Each `Item` exposes
    ``slug`` (e.g. ``GMAIL_SEND_EMAIL``), ``name``, ``human_description``,
    ``input_parameters`` and ``toolkit.slug``.
    """
    if not toolkits:
        return []
    items: list[Any] = []
    # The SDK's `get_raw_composio_tools` filters reliably only when asked for a
    # single toolkit at a time; a multi-toolkit call returns just one page of the
    # union (e.g. the first app's tools) and silently drops the rest.
    for toolkit in sorted(toolkits):
        collection = await asyncio.to_thread(
            client.tools.get_raw_composio_tools, toolkits=[toolkit], limit=1000
        )
        items.extend(list(collection or []))
    return items


async def sync_connections(
    db: AsyncSession,
    user_id: str,
    states: dict[str, dict[str, Any]],
    configured: set[str] | None = None,
) -> None:
    """Mirror authoritative Composio state into `composio_connections` rows."""
    entity = resolve_entity_id(user_id)
    scope = set(states)
    if configured is not None:
        scope &= configured

    rows = (
        (await db.execute(select(ComposioConnection).where(ComposioConnection.user_id == user_id)))
        .scalars()
        .all()
    )
    by_toolkit = {row.toolkit: row for row in rows}

    for slug in scope:
        state = states[slug]
        row = by_toolkit.get(slug)
        if row is None:
            row = ComposioConnection(user_id=user_id, entity_id=entity, toolkit=slug)
            db.add(row)
        row.status = state["status"]
        row.connected_account_id = state["connected_account_id"] or None
        row.alias = state["alias"]
        if state["status"] == "ACTIVE":
            row.connected_at = _coerce_dt(state["connected_at"]) or datetime.now(UTC)

    stale = [row for toolkit, row in by_toolkit.items() if toolkit not in scope]
    for row in stale:
        await db.delete(row)

    await db.flush()


async def sync_composio_connections(db: AsyncSession, user_id: str) -> dict[str, dict[str, Any]]:
    """Refresh the user's local connection snapshot from Composio. Returns states."""
    client = get_composio()
    if client is None:
        return {}
    configured = configured_toolkit_ids()
    if not configured:
        return {}
    session = client.create(user_id=resolve_entity_id(user_id))
    states = await fetch_toolkit_states(session)
    await sync_connections(db, user_id, states, configured)
    return states


async def get_connection_url(user_id: str, toolkit: str, callback_url: str | None = None) -> str:
    """Start a Composio connect flow and return the OAuth redirect URL for the user."""
    client = get_composio()
    if client is None:
        raise ConnectorError("Composio integration is not configured on this server")
    session = client.create(user_id=resolve_entity_id(user_id))
    try:
        request = await asyncio.to_thread(session.authorize, toolkit, callback_url=callback_url)
    except Exception as err:
        raise ConnectorError(f"Composio connection request failed: {err}") from err
    redirect_url = _attr(request, "redirect_url", None)
    if not redirect_url:
        raise ConnectorError("Composio did not return a redirect URL")
    return redirect_url


async def disconnect_connection(db: AsyncSession, user_id: str, toolkit: str) -> dict[str, Any]:
    """Delete the user's Composio connected account and its local mirror row."""
    client = get_composio()
    if client is None:
        raise ConnectorError("Composio integration is not configured on this server")
    entity = resolve_entity_id(user_id)
    try:
        listings = await asyncio.to_thread(
            client.connected_accounts.list,
            user_ids=[entity],
            toolkit_slugs=[toolkit],
        )
        for account in _attr(listings, "items", None) or []:
            account_id = _attr(account, "id", None)
            if account_id:
                await asyncio.to_thread(
                    client.connected_accounts.delete, account_id, revoke_on_delete=True
                )
    except Exception as err:
        raise ConnectorError(f"Composio disconnect failed: {err}") from err

    await db.execute(
        delete(ComposioConnection).where(
            ComposioConnection.user_id == user_id,
            ComposioConnection.toolkit == toolkit,
        )
    )
    await db.flush()
    return {"disconnected": True, "toolkit": toolkit}


async def ensure_webhook_subscription() -> dict | None:
    """Register this server's webhook endpoint with Composio (idempotent)."""
    client = get_composio()
    if client is None or not configured_toolkit_ids():
        return None
    try:
        subscription = await asyncio.to_thread(
            client.triggers.set_webhook_subscription,
            webhook_url=webhook_url(),
            enabled_events=_WEBHOOK_ENABLED_EVENTS,
        )
        return {
            "webhook_url": _attr(subscription, "webhook_url", None) or webhook_url(),
            "version": _attr(subscription, "version", None),
            "enabled_events": list(_attr(subscription, "enabled_events", None) or []),
        }
    except Exception as err:  # noqa: BLE001 — startup/subscription must not crash
        logger.warning("composio webhook subscription failed: %s", err)
        return None


async def parse_webhook(raw_body: bytes, headers: Any, *, verify_secret: str | None) -> dict:
    """Verify + normalize an incoming Composio webhook payload.

    Returns ``{"raw_payload": dict, "payload": dict|None}``. Raises
    :class:`ConnectorError` when the signature can't be validated or the body
    isn't a known webhook payload.
    """
    client = get_composio()
    if client is None:
        raise ConnectorError("Composio is not configured on this server")
    kwargs: dict[str, Any] = {"body": raw_body, "headers": headers}
    if verify_secret:
        kwargs["verify_secret"] = verify_secret
    try:
        result = await asyncio.to_thread(client.triggers.parse, **kwargs)
    except Exception as err:
        raise ConnectorError(f"Composio webhook rejected: {err}") from err
    return {
        "raw_payload": result.get("raw_payload") if isinstance(result, dict) else None,
        "payload": result.get("payload") if isinstance(result, dict) else None,
    }


def classify_webhook_event(raw: Any) -> str:
    """'connection' | 'trigger' | 'unknown' for a raw webhook payload."""
    if not isinstance(raw, dict):
        return "unknown"
    event_type = raw.get("type")
    if isinstance(event_type, str):
        event_type = event_type.lower()
        if "trigger" in event_type:
            return "trigger"
        if "connected_account" in event_type or "connection" in event_type:
            return "connection"
    if isinstance(raw.get("trigger_name"), str):
        return "trigger"
    metadata = raw.get("metadata")
    if isinstance(metadata, dict) and "trigger" in str(metadata.get("type", "")).lower():
        return "trigger"
    return "unknown"


def connection_event_fields(raw: Any) -> dict[str, Any] | None:
    """Extract toolkit/status/account fields from a connection webhook event."""
    if not isinstance(raw, dict):
        return None
    data = raw.get("data")
    if not isinstance(data, dict):
        return None
    toolkit = data.get("toolkit")
    toolkit_slug = toolkit.get("slug") if isinstance(toolkit, dict) else None
    status = data.get("status")
    if not isinstance(toolkit_slug, str) or not isinstance(status, str):
        return None
    return {
        "entity_id": data.get("entity_id") or data.get("user_id"),
        "toolkit": toolkit_slug.lower(),
        "status": status.upper(),
        "status_reason": data.get("status_reason"),
        "connected_account_id": data.get("id"),
        "connected_at": data.get("connected_at"),
    }


def trigger_event_fields(event: Any) -> dict[str, str]:
    """User/toolkit/trigger identifiers from a normalized trigger event.

    Trigger payload data is deliberately NOT included — we never persist it.
    """
    if not isinstance(event, dict):
        return {"user_id": "", "toolkit": "", "trigger_slug": ""}
    user_id = event.get("user_id") or ""
    if not user_id:
        metadata = event.get("metadata")
        if isinstance(metadata, dict):
            account = metadata.get("connected_account")
            if isinstance(account, dict):
                user_id = account.get("user_id") or ""
    return {
        "user_id": str(user_id),
        "toolkit": str(event.get("toolkit_slug") or ""),
        "trigger_slug": str(event.get("trigger_slug") or ""),
    }


async def handle_webhook_event(
    db: AsyncSession, raw: Any, normalized: Any = None
) -> dict[str, Any]:
    """Apply a verified webhook event to the local `composio_connections` state."""
    kind = classify_webhook_event(raw)
    if kind == "connection":
        fields = connection_event_fields(raw)
        if fields is None:
            return {"kind": "connection", "ignored": True}
        user_id = user_from_entity_id(fields["entity_id"])
        if user_id is None:
            logger.warning("composio webhook for unknown entity %r ignored", fields["entity_id"])
            return {"kind": "connection", "ignored": True}
        toolkit = fields["toolkit"]
        row = (
            await db.execute(
                select(ComposioConnection).where(
                    ComposioConnection.user_id == user_id,
                    ComposioConnection.toolkit == toolkit,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            row = ComposioConnection(
                user_id=user_id, entity_id=resolve_entity_id(user_id), toolkit=toolkit
            )
            db.add(row)
        row.status = fields["status"]
        row.status_reason = fields["status_reason"]
        row.connected_account_id = fields["connected_account_id"]
        if fields["status"] == "ACTIVE":
            row.connected_at = _coerce_dt(fields["connected_at"]) or datetime.now(UTC)
        await db.flush()
        return {"kind": "connection", "toolkit": toolkit, "status": fields["status"]}

    if kind == "trigger":
        fields = trigger_event_fields(normalized)
        user_id = user_from_entity_id(fields["user_id"])
        toolkit = fields["toolkit"]
        if user_id is not None and toolkit:
            row = (
                await db.execute(
                    select(ComposioConnection).where(
                        ComposioConnection.user_id == user_id,
                        ComposioConnection.toolkit == toolkit,
                    )
                )
            ).scalar_one_or_none()
            if row is not None:
                row.last_trigger_event_at = datetime.now(UTC)
                await db.flush()
        return {"kind": "trigger", "toolkit": toolkit, "trigger_slug": fields["trigger_slug"]}

    return {"kind": "unknown", "ignored": True}


async def build_composio_tools(
    user_id: str,
    create_pending_action: Callable[[dict], Awaitable[dict]] | None = None,
    db: AsyncSession | None = None,
) -> tuple[dict[str, ConnectorTool], Callable[[], int]]:
    """Tools for the user's ACTIVE Composio connections, plus a call counter.

    The counter lets the agent run charge ``composio_tool`` credits per executed
    call. Returns empty when Composio is unconfigured or unreachable. When `db`
    is given, the authoritative connection snapshot is mirrored into
    `composio_connections` (best-effort).
    """
    client = get_composio()
    if client is None:
        return {}, _noop_counter
    configured = configured_toolkit_ids()
    if not configured:
        return {}, _noop_counter

    try:
        session = client.create(user_id=resolve_entity_id(user_id))
        states = await fetch_toolkit_states(session)
    except Exception as err:
        logger.warning("composio session lookup failed for %s: %s", user_id, err)
        return {}, _noop_counter
    connected = {slug for slug, state in states.items() if state["active"]} & configured
    if db is not None:
        try:
            await sync_connections(db, user_id, states, configured)
        except Exception as err:
            logger.warning("composio connection sync failed for %s: %s", user_id, err)

    tools: dict[str, ConnectorTool] = {}
    tally = {"n": 0}
    _ctx = ConnectorContext(
        user_id=user_id,
        get_access_token=_never_tokens,
        create_pending_action=create_pending_action,
    )

    def _make_execute(
        slug: str, display: str, risk: str | None
    ) -> Callable[[dict], Awaitable[Any]]:
        async def _run_tool(_args: dict) -> Any:
            tally["n"] += 1
            try:
                response = await asyncio.to_thread(session.execute, slug, arguments=_args)
            except Exception as err:
                return _composio_error(err)
            error = _attr(response, "error", None)
            if error:
                return _composio_error(error)
            data = _attr(response, "data", None)
            if data is None:
                return {"ok": True}
            return data if isinstance(data, dict) else {"result": data}

        async def _execute(args: dict) -> Any:
            if risk is None:
                return await _run_tool(args)
            return await gate_write(
                _ctx,
                _gate_meta(slug, display, risk, args),
                args,
                lambda: _run_tool(args),
            )

        return _execute

    async def _discover() -> None:
        if not connected:
            return
        items = await fetch_tool_items(client, sorted(connected))
        by_toolkit: dict[str, list[Any]] = {}
        for item in items:
            if _is_deprecated(item):
                continue
            by_toolkit.setdefault(_toolkit_slug(item) or "", []).append(item)
        per_app_limit = settings.composio_max_tools_per_app
        remaining = settings.composio_max_tools
        for toolkit in sorted(connected):
            if remaining <= 0:
                break
            pool = sorted(
                by_toolkit.get(toolkit, []),
                key=lambda it: _tool_priority(_item_slug(it)),
            )
            kept = pool[: min(per_app_limit, remaining)]
            remaining -= len(kept)
            for item in kept:
                slug = _item_slug(item)
                if not slug:
                    continue
                display = _attr(item, "name", None) or slug
                description = (
                    _attr(item, "human_description", None)
                    or _attr(item, "description", None)
                    or f"Composio tool {slug}"
                )
                parameters = _compiled_parameters(_attr(item, "input_parameters", None))
                risk = _risk_for_slug(str(slug))
                tools[slug] = ConnectorTool(
                    name=slug,
                    description=description,
                    parameters=parameters,
                    execute=_make_execute(str(slug), str(display), risk),
                )

    try:
        await _discover()
    except Exception as err:
        logger.warning("composio tool discovery failed for %s: %s", user_id, err)
        return {}, _noop_counter
    return tools, lambda: tally["n"]
