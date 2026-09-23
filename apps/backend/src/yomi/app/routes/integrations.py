from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_current_user_query, get_db_session
from yomi.conf import settings
from yomi.crypto import decrypt_tokens, encrypt_tokens, refresh_google_access_token
from yomi.db.models_app2 import McpConnection
from yomi.db.models_auth import User
from yomi.services import connectors_d1
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend
from yomi.services.oauth import build_auth_url, handle_callback

logger = logging.getLogger(__name__)

integrations_router = APIRouter(prefix="/api/integrations")


@integrations_router.get("")
async def list_integrations(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        return {"integrations": await connectors_d1.list_connections(d1, str(user.id))}
    rows = (
        (await db.execute(select(McpConnection).where(McpConnection.user_id == user.id)))
        .scalars()
        .all()
    )

    # We shouldn't return the raw tokens to the client
    integrations = [
        {
            "id": str(r.id),
            "provider": r.provider,
            "scopes": r.scopes,
            "displayName": r.display_name,
            "expiresAt": r.expires_at,
            "lastSyncAt": r.last_sync_at,
        }
        for r in rows
    ]
    return {"integrations": integrations}


def _health_entry(
    provider: str,
    *,
    display_name: str | None,
    healthy: bool,
    updated_at: str | None,
) -> dict:
    return {
        "provider": provider,
        "displayName": display_name,
        "connected": True,
        "healthy": healthy,
        "status": "connected" if healthy else "needs_reconnect",
        "message": None if healthy else "Token expired or revoked — reconnect in Integrations",
        "updatedAt": updated_at,
    }


@integrations_router.get("/status")
async def integrations_status(
    health: str | None = None,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    """Dashboard connections status: `connected` ids + per-provider health.

    Local state only (no network probes) — `?health=1` is accepted for shape
    compatibility with the dashboard's integrations tab. `connected` mirrors the
    catalog ids: native connectors from `mcp_connections` plus active Composio
    toolkits (slugs mapped back to catalog ids).
    """
    from yomi.connectors.composio import connector_id_for_toolkit

    entries: dict[str, dict] = {}

    if d1 is not None:
        uid = str(user.id)
        for row in await connectors_d1.list_connections(d1, uid):
            provider = str(row["provider"])
            healthy = False
            full = await connectors_d1.find_connection(d1, uid, provider)
            if full and full.get("oauth_tokens"):
                try:
                    decrypt_tokens(str(full["oauth_tokens"]))
                    healthy = True
                except Exception:
                    healthy = False
            entries[provider] = _health_entry(
                provider,
                display_name=row.get("displayName"),
                healthy=healthy,
                updated_at=(full or {}).get("updated_at") or row.get("lastSyncAt"),
            )
        for row in await connectors_d1.composio_connection_rows(d1, uid):
            if str(row.get("status", "")).upper() != "ACTIVE":
                continue
            provider = connector_id_for_toolkit(str(row.get("toolkit")))
            entries[provider] = _health_entry(
                provider,
                display_name=row.get("alias"),
                healthy=True,
                updated_at=row.get("connected_at") or row.get("updated_at"),
            )
    else:
        for r in (
            (await db.execute(select(McpConnection).where(McpConnection.user_id == user.id)))
            .scalars()
            .all()
        ):
            provider = str(r.provider)
            healthy = False
            if r.oauth_tokens:
                try:
                    decrypt_tokens(r.oauth_tokens)
                    healthy = True
                except Exception:
                    healthy = False
            updated = r.updated_at.isoformat() if getattr(r, "updated_at", None) else None
            entries[provider] = _health_entry(
                provider, display_name=r.display_name, healthy=healthy, updated_at=updated
            )
        from yomi.db.models_app2 import ComposioConnection

        for r in (
            (
                await db.execute(
                    select(ComposioConnection).where(ComposioConnection.user_id == user.id)
                )
            )
            .scalars()
            .all()
        ):
            if str(r.status).upper() != "ACTIVE":
                continue
            provider = connector_id_for_toolkit(r.toolkit)
            updated = r.connected_at.isoformat() if r.connected_at else None
            entries[provider] = _health_entry(
                provider, display_name=r.alias, healthy=True, updated_at=updated
            )

    return {
        "connected": sorted(entries),
        "integrations": [entries[key] for key in sorted(entries)],
    }


@integrations_router.get("/composio/status")
async def composio_status(
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    from yomi.connectors.composio import configured_toolkit_ids

    if d1 is not None:
        rows = await connectors_d1.composio_connection_rows(d1, str(user.id))
        by_toolkit = {str(row["toolkit"]): row for row in rows}
        return {
            "configured": sorted(configured_toolkit_ids()),
            "connections": [
                {
                    "toolkit": row["toolkit"],
                    "status": row["status"],
                    "statusReason": row.get("status_reason"),
                    "connectedAccountId": row.get("connected_account_id"),
                    "alias": row.get("alias"),
                    "connectedAt": row.get("connected_at"),
                    "lastTriggerEventAt": row.get("last_trigger_event_at"),
                }
                for row in rows
            ],
            "lastSyncedToolkits": list(by_toolkit),
        }
    from yomi.db.models_app2 import ComposioConnection

    rows = (
        (await db.execute(select(ComposioConnection).where(ComposioConnection.user_id == user.id)))
        .scalars()
        .all()
    )
    by_toolkit = {row.toolkit: row for row in rows}
    return {
        "configured": sorted(configured_toolkit_ids()),
        "connections": [
            {
                "toolkit": r.toolkit,
                "status": r.status,
                "statusReason": r.status_reason,
                "connectedAccountId": r.connected_account_id,
                "alias": r.alias,
                "connectedAt": r.connected_at,
                "lastTriggerEventAt": r.last_trigger_event_at,
            }
            for r in rows
        ],
        "lastSyncedToolkits": list(by_toolkit),
    }


@integrations_router.get("/composio/connect")
async def connect_composio(
    toolkit: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
    callback_url: str | None = None,
):
    from yomi.connectors.composio import (
        ConnectorError,
        configured_toolkit_ids,
        connected_toolkit_ids,
        get_composio,
        get_connection_url,
        resolve_entity_id,
    )

    client = get_composio()
    configured = configured_toolkit_ids()
    if client is None or not configured:
        raise HTTPException(status_code=503, detail="Composio is not configured on this server")
    if toolkit not in configured:
        allowed = ", ".join(sorted(configured))
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported Composio toolkit '{toolkit}'. Supported: {allowed}",
        )

    if not callback_url:
        host = request.headers.get("host", "localhost:8000")
        scheme = request.headers.get("x-forwarded-proto", "http")
        callback_url = f"{scheme}://{host}/dashboard"

    session = client.create(user_id=resolve_entity_id(str(user.id)))
    try:
        connected = await connected_toolkit_ids(session, configured)
        if toolkit in connected:
            return {"status": "connected", "url": None}
        url = await get_connection_url(str(user.id), toolkit, callback_url)
    except ConnectorError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "needs_connection", "url": url}


@integrations_router.delete("/composio/{toolkit}")
async def disconnect_composio(
    toolkit: str,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    from yomi.connectors.composio import ConnectorError, disconnect_connection

    try:
        if d1 is not None:
            return await connectors_d1.disconnect_composio_connection(d1, str(user.id), toolkit)
        return await disconnect_connection(db, str(user.id), toolkit)
    except ConnectorError as e:
        raise HTTPException(status_code=400, detail=str(e))


@integrations_router.get("/{provider}/connect")
async def connect_integration(
    provider: str,
    request: Request,
    user: User = Depends(get_current_user),
):
    # Determine redirect URI based on request
    # Use a generic or environment-based base URL in real app
    host = request.headers.get("host", "localhost:8000")
    scheme = request.headers.get("x-forwarded-proto", "http")
    redirect_uri = f"{scheme}://{host}/api/integrations/callback"

    try:
        url = build_auth_url(provider, str(user.id), redirect_uri)
        return {"url": url}
    except Exception as e:
        logger.error(f"Error building auth url for {provider}: {e}")
        raise HTTPException(status_code=500, detail="Failed to initiate connection")


@integrations_router.get("/callback")
async def oauth_callback(
    request: Request,
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db_session),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    try:
        state_data = json.loads(state)
        user_id = state_data.get("user_id")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid state")

    if not user_id:
        raise HTTPException(status_code=400, detail="Missing user_id in state")

    # In a real app we'd probably have the provider in the state or the redirect path
    # For now, default to google or parse from context. Let's assume google for now.
    provider = "google"

    host = request.headers.get("host", "localhost:8000")
    scheme = request.headers.get("x-forwarded-proto", "http")
    redirect_uri = f"{scheme}://{host}/api/integrations/callback"

    try:
        tokens = await handle_callback(provider, code, redirect_uri)
    except Exception as e:
        logger.error(f"OAuth callback failed: {e}")
        raise HTTPException(status_code=400, detail="OAuth exchange failed")

    encrypted = encrypt_tokens(tokens)

    if d1 is not None:
        await connectors_d1.upsert_connection(
            d1,
            str(user_id),
            provider,
            encrypted,
            scopes=tokens.scope.split() if tokens.scope else [],
        )
        return {"message": "Integration connected successfully", "close_window": True}

    existing = (
        await db.execute(
            select(McpConnection).where(
                McpConnection.user_id == user_id, McpConnection.provider == provider
            )
        )
    ).scalar_one_or_none()

    if existing:
        await db.execute(
            update(McpConnection)
            .where(McpConnection.id == existing.id)
            .values(
                oauth_tokens=encrypted,
                updated_at=datetime.now(UTC),
            )
        )
    else:
        db.add(
            McpConnection(
                user_id=user_id,
                provider=provider,
                oauth_tokens=encrypted,
                scopes=tokens.scope.split() if tokens.scope else [],
            )
        )

    await db.commit()
    # Redirect to frontend success page
    return {"message": "Integration connected successfully", "close_window": True}


@integrations_router.delete("/{provider}")
async def revoke_integration(
    provider: str,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    from yomi.connectors.composio import (
        ConnectorError,
        configured_toolkit_ids,
        toolkit_slug_for_connector,
    )

    toolkit = toolkit_slug_for_connector(provider)
    if toolkit in configured_toolkit_ids():
        try:
            if d1 is not None:
                try:
                    return await connectors_d1.disconnect_composio_connection(
                        d1, str(user.id), toolkit
                    )
                except ConnectorError:
                    # Composio unreachable / unconfigured — still drop the mirror
                    # so the dashboard's connected flag clears.
                    await connectors_d1.delete_composio_mirror(d1, str(user.id), toolkit)
                    return {"success": True, "disconnected": True, "toolkit": toolkit}
            from yomi.connectors.composio import disconnect_connection

            return await disconnect_connection(db, str(user.id), toolkit)
        except ConnectorError as e:
            raise HTTPException(status_code=400, detail=str(e))

    if d1 is not None:
        await connectors_d1.delete_connection(d1, str(user.id), provider)
        return {"success": True}
    await db.execute(
        delete(McpConnection).where(
            McpConnection.user_id == user.id, McpConnection.provider == provider
        )
    )
    await db.commit()
    return {"success": True}


@integrations_router.get("/{provider}/health")
async def integration_health(
    provider: str,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        conn = await connectors_d1.find_connection(d1, str(user.id), provider)
        if conn is None:
            return {"status": "unconfigured"}
        try:
            tokens = decrypt_tokens(str(conn["oauth_tokens"]))
        except Exception:
            return {"status": "invalid_tokens"}
        if provider != "google":
            logger.warning(f"Health check not fully implemented for {provider}")
            return {"status": "ok"}
        async with httpx.AsyncClient() as client:
            res = await client.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {tokens.access_token}"},
            )
            if res.status_code == 200:
                return {"status": "ok"}
            if res.status_code == 401 and tokens.refresh_token:
                try:
                    new_tokens = await refresh_google_access_token(tokens.refresh_token)
                    await connectors_d1.upsert_connection(
                        d1,
                        str(user.id),
                        provider,
                        encrypt_tokens(new_tokens),
                    )
                    return {"status": "ok"}
                except Exception:
                    return {"status": "error"}
        return {"status": "error"}
    conn = (
        await db.execute(
            select(McpConnection).where(
                McpConnection.user_id == user.id, McpConnection.provider == provider
            )
        )
    ).scalar_one_or_none()

    if not conn:
        return {"status": "unconfigured"}

    try:
        tokens = decrypt_tokens(conn.oauth_tokens)
    except Exception:
        return {"status": "invalid_tokens"}

    healthy = False

    async with httpx.AsyncClient() as client:
        if provider == "google":
            # Check userinfo
            res = await client.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {tokens.access_token}"},
            )
            if res.status_code == 200:
                healthy = True
            elif res.status_code == 401 and tokens.refresh_token:
                try:
                    new_tokens = await refresh_google_access_token(tokens.refresh_token)
                    encrypted = encrypt_tokens(new_tokens)
                    await db.execute(
                        update(McpConnection)
                        .where(McpConnection.id == conn.id)
                        .values(oauth_tokens=encrypted, updated_at=datetime.now(UTC))
                    )
                    await db.commit()
                    healthy = True
                except Exception:
                    healthy = False
        else:
            logger.warning(f"Health check not fully implemented for {provider}")
            healthy = True  # optimistic stub

    return {"status": "ok" if healthy else "error"}


@integrations_router.get("/connect/{connector_id}")
async def connect_connector(
    connector_id: str,
    request: Request,
    user: User = Depends(get_current_user_query),
    db: AsyncSession = Depends(get_db_session),
):
    """Dashboard connector connect (opened as a new tab, `?session=` auth).

    Routes by catalog id: every configured connector goes through Composio
    (Google's catalog ids map to their Composio toolkit slugs). Anything else
    (unconfigured / unknown ids, api-key and connection-string kinds the backend
    does not implement) is a 404.
    """
    from yomi.connectors.composio import (
        ConnectorError,
        configured_toolkit_ids,
        connected_toolkit_ids,
        get_composio,
        get_connection_url,
        resolve_entity_id,
        toolkit_slug_for_connector,
    )

    configured = configured_toolkit_ids()
    toolkit = toolkit_slug_for_connector(connector_id)
    if toolkit not in configured:
        raise HTTPException(
            status_code=404,
            detail=f"Connector '{connector_id}' is not available on this server",
        )
    client = get_composio()
    if client is None:
        raise HTTPException(status_code=503, detail="Composio is not configured on this server")
    callback_url = f"{settings.app_url.rstrip('/')}/dashboard?connect={connector_id}"
    session = client.create(user_id=resolve_entity_id(str(user.id)))
    try:
        connected = await connected_toolkit_ids(session, configured)
        if toolkit in connected:
            return {"kind": "composio", "id": connector_id, "status": "connected", "url": None}
        url = await get_connection_url(str(user.id), toolkit, callback_url)
    except ConnectorError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"kind": "composio", "id": connector_id, "status": "needs_connection", "url": url}
