"""D1 implementation of connector storage paths.

Mirrors ``connectors/tokens.py`` (OAuth token resolution + Google refresh),
``connectors/pending.py`` (approval rows), the platform-link helpers in
``gateway/telegram.py``, and the ``composio_connections`` mirror writes in
``connectors/composio.py``. Composio API calls themselves are reused from the
``composio`` module; only the local mirror moves to D1.

Differences from the Postgres versions, all D1-motivated:
- no ``_is_uuid`` gate on ``user_id`` (D1 has no uuid-typed column to protect)
- ``scopes`` arrays are JSON text; datetimes are ISO strings
- mirror upserts are explicit SELECT-then-INSERT/UPDATE (no ORM flush)
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from typing import Any

from yomi.connectors.base import ConnectorError
from yomi.connectors.composio import (
    fetch_toolkit_states,
    get_composio,
    resolve_entity_id,
    user_from_entity_id,
)
from yomi.crypto import decrypt_tokens, encrypt_tokens, refresh_google_access_token
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import parse_dt, utcnow_iso

logger = logging.getLogger(__name__)

_REFRESH_MARGIN_MS = 60_000
_GOOGLE_PROVIDERS = frozenset({"google", "google-calendar", "google-drive"})
PENDING_TTL = timedelta(days=7)
TELEGRAM_LINK_TTL = timedelta(minutes=10)


def _parse_json_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value]
    if isinstance(value, str) and value:
        import json

        try:
            parsed = json.loads(value)
        except ValueError:
            return []
        if isinstance(parsed, list):
            return [str(v) for v in parsed]
    return []


async def list_connections(backend: D1Backend, user_id: str) -> list[dict[str, Any]]:
    rows = await backend.store.fetch_all(
        "SELECT * FROM mcp_connections WHERE user_id = ?", [user_id]
    )
    return [
        {
            "id": str(row["id"]),
            "provider": row["provider"],
            "scopes": _parse_json_list(row.get("scopes")),
            "displayName": row.get("display_name"),
            "expiresAt": row.get("expires_at"),
            "lastSyncAt": row.get("last_sync_at"),
        }
        for row in rows
    ]


async def find_connection(
    backend: D1Backend, user_id: str, provider: str
) -> dict | None:
    return await backend.store.fetch_one(
        "SELECT * FROM mcp_connections WHERE user_id = ? AND provider = ? LIMIT 1",
        [user_id, provider],
    )


async def connected_providers(backend: D1Backend, user_id: str) -> set[str]:
    rows = await backend.store.fetch_all(
        "SELECT provider FROM mcp_connections WHERE user_id = ?", [user_id]
    )
    return {str(row["provider"]) for row in rows}


async def upsert_connection(
    backend: D1Backend,
    user_id: str,
    provider: str,
    oauth_tokens: str,
    scopes: list[str] | None = None,
) -> None:
    now = utcnow_iso()
    existing = await find_connection(backend, user_id, provider)
    if existing is None:
        await backend.store.atomic([
            backend.store.insert("mcp_connections", {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "provider": provider,
                "oauth_tokens": oauth_tokens,
                "scopes": scopes or [],
                "display_name": None,
                "expires_at": None,
                "last_sync_at": None,
                "created_at": now,
                "updated_at": now,
            })
        ])
    else:
        await backend.store.atomic([
            Statement(
                "UPDATE mcp_connections SET oauth_tokens = ?, updated_at = ? WHERE id = ?",
                [oauth_tokens, now, existing["id"]],
            )
        ])


async def delete_connection(backend: D1Backend, user_id: str, provider: str) -> bool:
    results = await backend.store.atomic([
        Statement(
            "DELETE FROM mcp_connections WHERE user_id = ? AND provider = ? RETURNING id",
            [user_id, provider],
        )
    ])
    return bool(results[0].get("results"))


async def get_access_token(backend: D1Backend, user_id: str, provider: str) -> str:
    """Live API token for the user/provider, refreshing Google tokens early."""
    conn = await find_connection(backend, user_id, provider)
    if conn is None or not conn.get("oauth_tokens"):
        raise ConnectorError(f"{provider} is not connected")
    tokens = decrypt_tokens(str(conn["oauth_tokens"]))
    expires = tokens.expires_at
    if (
        provider in _GOOGLE_PROVIDERS
        and tokens.refresh_token
        and expires is not None
        and expires - _REFRESH_MARGIN_MS <= int(time.time() * 1000)
    ):
        refreshed = await refresh_google_access_token(tokens.refresh_token)
        await backend.store.atomic([
            Statement(
                "UPDATE mcp_connections SET oauth_tokens = ?, updated_at = ? WHERE id = ?",
                [encrypt_tokens(refreshed), utcnow_iso(), conn["id"]],
            )
        ])
        return refreshed.access_token
    return tokens.access_token


def token_provider(backend: D1Backend) -> Callable[[str, str], Awaitable[str]]:
    async def _get(user_id: str, provider: str) -> str:
        return await get_access_token(backend, user_id, provider)

    return _get


def create_pending_action(
    backend: D1Backend,
    *,
    user_id: str,
    source_platform: str | None = None,
    source_chat_id: str | None = None,
    requested_by_run_id: str | uuid.UUID | None = None,
) -> Callable[[dict], Awaitable[dict]]:
    """D1 counterpart of ``connectors.pending.create_pending_action``."""

    async def creator(meta: dict[str, Any]) -> dict[str, Any]:
        action_id = str(uuid.uuid4())
        await backend.store.atomic([
            backend.store.insert("pending_actions", {
                "id": action_id,
                "user_id": user_id,
                "connector": meta["connector"],
                "action": meta["action"],
                "risk": meta["risk"],
                "title": meta["title"],
                "preview": meta["preview"],
                "confirm_text": meta.get("confirm_text"),
                "payload": meta["payload"],
                "status": "pending",
                "result": None,
                "source_platform": source_platform,
                "source_chat_id": source_chat_id,
                "requested_by_run_id": (
                    str(requested_by_run_id) if requested_by_run_id is not None else None
                ),
                "expires_at": (datetime.now(UTC) + PENDING_TTL).isoformat(),
                "decided_at": None,
                "executed_at": None,
                "created_at": utcnow_iso(),
                "updated_at": utcnow_iso(),
            })
        ])
        if source_platform == "telegram" and source_chat_id:
            from yomi.gateway.telegram import send_approval_prompt

            with suppress(Exception):
                await send_approval_prompt(source_chat_id, action_id, meta)
        return {
            "id": action_id,
            "status": "pending",
            "message": (
                f"{meta['title']} — waiting for the user's approval. They have been sent "
                "Approve/Reject buttons; don't ask them to confirm again in text."
            ),
        }

    return creator


async def resolve_platform_user(
    backend: D1Backend, platform: str, platform_user_id: str, chat_id: str
) -> str | None:
    """Canonical user id for a platform identity, or None when unlinked."""
    row = await backend.store.fetch_one(
        "SELECT user_id FROM platform_connections WHERE platform = ? AND "
        "(platform_user_id = ? OR platform_chat_id = ?) LIMIT 1",
        [platform, platform_user_id, chat_id],
    )
    return str(row["user_id"]) if row else None


async def link_with_code(
    backend: D1Backend, platform: str, platform_user_id: str, chat_id: str, code: str
) -> None:
    """Consume a link token and upsert the platform connection. Idempotent."""
    token = await backend.store.fetch_one(
        "SELECT * FROM telegram_link_tokens WHERE token = ? LIMIT 1", [code.strip()]
    )
    if token is None or token.get("used"):
        raise ValueError("invalid or expired link code")
    expires = parse_dt(token.get("expires_at"))
    if expires is None or expires < datetime.now(UTC):
        raise ValueError("invalid or expired link code")
    now = utcnow_iso()
    user_id = str(token["user_id"])
    previous_owner = await resolve_platform_user(backend, platform, platform_user_id, chat_id)
    await backend.store.atomic([
        Statement(
            "UPDATE telegram_link_tokens SET used = 1, telegram_user_id = ? WHERE token = ?",
            [platform_user_id, token["token"]],
        ),
        Statement(
            "UPDATE platform_connections SET user_id = ?, platform_chat_id = ?, "
            "updated_at = ? WHERE platform = ? AND platform_user_id = ?",
            [user_id, chat_id, now, platform, platform_user_id],
        ),
    ])
    linked = await backend.store.fetch_one(
        "SELECT id FROM platform_connections WHERE platform = ? AND platform_user_id = ? "
        "LIMIT 1",
        [platform, platform_user_id],
    )
    if linked is None:
        await backend.store.atomic([
            backend.store.insert("platform_connections", {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "platform": platform,
                "platform_user_id": platform_user_id,
                "platform_chat_id": chat_id,
                "connected_at": now,
                "updated_at": now,
            })
        ])
    if previous_owner is not None and previous_owner != user_id:
        from yomi.services import account_merge_d1

        try:
            await account_merge_d1.merge_placeholder(backend, previous_owner, user_id)
        except Exception:  # linking already succeeded; a failed merge leaves both accounts
            logger.exception("could not merge %s into %s", previous_owner, user_id)


async def create_link_token(backend: D1Backend, user_id: str) -> str:
    import secrets as _secrets

    token = _secrets.token_urlsafe(24)
    now = datetime.now(UTC)
    await backend.store.atomic([
        backend.store.insert("telegram_link_tokens", {
            "token": token,
            "user_id": user_id,
            "created_at": now.isoformat(),
            "expires_at": (now + TELEGRAM_LINK_TTL).isoformat(),
            "used": 0,
            "telegram_user_id": None,
        })
    ])
    return token


async def sync_composio_connections(
    backend: D1Backend, user_id: str
) -> dict[str, dict[str, Any]]:
    """Refresh the local Composio mirror from the Composio API. Returns states."""
    from yomi.connectors.composio import configured_toolkit_ids

    client = get_composio()
    if client is None:
        return {}
    configured = configured_toolkit_ids()
    if not configured:
        return {}
    session = client.create(user_id=resolve_entity_id(user_id))
    states = await fetch_toolkit_states(session)
    await sync_connections(backend, user_id, states, configured)
    return states


async def sync_connections(
    backend: D1Backend,
    user_id: str,
    states: dict[str, dict[str, Any]],
    configured: set[str] | None = None,
) -> None:
    """Mirror authoritative Composio state into ``composio_connections`` rows."""
    entity = resolve_entity_id(user_id)
    scope = set(states)
    if configured is not None:
        scope &= configured
    rows = await backend.store.fetch_all(
        "SELECT * FROM composio_connections WHERE user_id = ?", [user_id]
    )
    by_toolkit = {str(row["toolkit"]): row for row in rows}
    now = utcnow_iso()
    statements: list[Statement] = []
    for slug in sorted(scope):
        state = states[slug]
        row = by_toolkit.get(slug)
        connected_at = state.get("connected_at")
        if isinstance(connected_at, datetime):
            connected_at = connected_at.isoformat()
        elif connected_at is not None:
            connected_at = str(connected_at)
        if state["status"] == "ACTIVE" and not connected_at:
            connected_at = datetime.now(UTC).isoformat()
        values = {
            "status": state["status"],
            "status_reason": state.get("status_reason"),
            "connected_account_id": state["connected_account_id"] or None,
            "alias": state["alias"],
            "updated_at": now,
        }
        if state["status"] == "ACTIVE":
            values["connected_at"] = connected_at
        if row is None:
            statements.append(backend.store.insert("composio_connections", {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "entity_id": entity,
                "toolkit": slug,
                **values,
                "connected_at": values.get("connected_at"),
                "last_trigger_event_at": None,
                "created_at": now,
            }))
        else:
            assignments = ", ".join(f"{key} = ?" for key in values)
            statements.append(Statement(
                f"UPDATE composio_connections SET {assignments} "
                "WHERE user_id = ? AND toolkit = ?",
                [*values.values(), user_id, slug],
            ))
    stale = [row for toolkit, row in by_toolkit.items() if toolkit not in scope]
    for row in stale:
        statements.append(Statement("DELETE FROM composio_connections WHERE id = ?", [row["id"]]))
    if statements:
        await backend.store.atomic(statements)


async def delete_composio_mirror(backend: D1Backend, user_id: str, toolkit: str) -> None:
    """Drop the local ``composio_connections`` mirror row without calling Composio."""
    await backend.store.atomic([
        Statement(
            "DELETE FROM composio_connections WHERE user_id = ? AND toolkit = ?",
            [user_id, toolkit],
        )
    ])


async def disconnect_composio_connection(
    backend: D1Backend, user_id: str, toolkit: str
) -> dict[str, Any]:
    """Delete the user's Composio connected account and its local mirror row."""
    from yomi.connectors.base import ConnectorError as _ConnectorError
    from yomi.connectors.composio import _attr

    client = get_composio()
    if client is None:
        raise _ConnectorError("Composio integration is not configured on this server")
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
        raise _ConnectorError(f"Composio disconnect failed: {err}") from err
    await backend.store.atomic([
        Statement(
            "DELETE FROM composio_connections WHERE user_id = ? AND toolkit = ?",
            [user_id, toolkit],
        )
    ])
    return {"disconnected": True, "toolkit": toolkit}


async def handle_composio_webhook_event(
    backend: D1Backend, raw: Any, normalized: Any = None
) -> dict[str, Any]:
    """Apply a verified Composio webhook event to the local mirror."""
    from yomi.connectors.composio import (
        classify_webhook_event,
        connection_event_fields,
        trigger_event_fields,
    )

    kind = classify_webhook_event(raw)
    if kind == "connection":
        fields = connection_event_fields(raw)
        if fields is None:
            return {"kind": "connection", "ignored": True}
        user_id = user_from_entity_id(fields["entity_id"])
        if user_id is None:
            return {"kind": "connection", "ignored": True}
        toolkit = fields["toolkit"]
        existing = await backend.store.fetch_one(
            "SELECT id FROM composio_connections WHERE user_id = ? AND toolkit = ? LIMIT 1",
            [user_id, toolkit],
        )
        now = utcnow_iso()
        connected_at = fields.get("connected_at")
        if fields["status"] == "ACTIVE" and not connected_at:
            connected_at = now
        if existing is None:
            await backend.store.atomic([
                backend.store.insert("composio_connections", {
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "entity_id": resolve_entity_id(user_id),
                    "toolkit": toolkit,
                    "status": fields["status"],
                    "status_reason": fields.get("status_reason"),
                    "connected_account_id": fields.get("connected_account_id"),
                    "alias": None,
                    "connected_at": connected_at,
                    "last_trigger_event_at": None,
                    "created_at": now,
                    "updated_at": now,
                })
            ])
        elif fields["status"] == "ACTIVE":
            await backend.store.atomic([
                Statement(
                    "UPDATE composio_connections SET status = ?, status_reason = ?, "
                    "connected_account_id = ?, connected_at = ?, updated_at = ? "
                    "WHERE id = ?",
                    [fields["status"], fields.get("status_reason"),
                     fields.get("connected_account_id"), connected_at, now, existing["id"]],
                )
            ])
        else:
            await backend.store.atomic([
                Statement(
                    "UPDATE composio_connections SET status = ?, status_reason = ?, "
                    "connected_account_id = ?, updated_at = ? WHERE id = ?",
                    [fields["status"], fields.get("status_reason"),
                     fields.get("connected_account_id"), now, existing["id"]],
                )
            ])
        return {"kind": "connection", "toolkit": toolkit, "status": fields["status"]}

    if kind == "trigger":
        fields = trigger_event_fields(normalized)
        user_id = user_from_entity_id(fields["user_id"])
        toolkit = fields["toolkit"]
        if user_id is not None and toolkit:
            existing = await backend.store.fetch_one(
                "SELECT id FROM composio_connections WHERE user_id = ? AND toolkit = ? LIMIT 1",
                [user_id, toolkit],
            )
            if existing is not None:
                await backend.store.atomic([
                    Statement(
                        "UPDATE composio_connections SET last_trigger_event_at = ?, "
                        "updated_at = ? WHERE id = ?",
                        [utcnow_iso(), utcnow_iso(), existing["id"]],
                    )
                ])
        return {"kind": "trigger", "toolkit": toolkit, "trigger_slug": fields["trigger_slug"]}

    return {"kind": "unknown", "ignored": True}


async def build_composio_tools_d1(
    backend: D1Backend,
    user_id: str,
    create_pending_action: Callable[[dict], Awaitable[dict]] | None = None,
):
    """Composio tools plus call counter, with the mirror synced to D1."""
    from yomi.connectors.composio import build_composio_tools

    tools, counter = await build_composio_tools(user_id, create_pending_action, db=None)
    with suppress(Exception):
        await sync_composio_connections(backend, user_id)
    return tools, counter


async def composio_connection_rows(
    backend: D1Backend, user_id: str
) -> list[dict[str, Any]]:
    return await backend.store.fetch_all(
        "SELECT * FROM composio_connections WHERE user_id = ?", [user_id]
    )
