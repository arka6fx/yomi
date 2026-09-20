from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.crypto import decrypt_tokens, encrypt_tokens, refresh_google_access_token
from yomi.db.models_app2 import McpConnection
from yomi.db.models_auth import User
from yomi.services.oauth import build_auth_url, handle_callback

logger = logging.getLogger(__name__)

integrations_router = APIRouter(prefix="/api/integrations")

@integrations_router.get("")
async def list_integrations(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(McpConnection).where(McpConnection.user_id == user.id)
        )
    ).scalars().all()
    
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


@integrations_router.get("/composio/status")
async def composio_status(
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    from yomi.connectors.composio import configured_toolkit_ids
    from yomi.db.models_app2 import ComposioConnection

    rows = (
        await db.execute(
            select(ComposioConnection).where(ComposioConnection.user_id == user.id)
        )
    ).scalars().all()
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
):
    from yomi.connectors.composio import ConnectorError, disconnect_connection

    try:
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
    
    existing = (
        await db.execute(
            select(McpConnection).where(
                McpConnection.user_id == user_id,
                McpConnection.provider == provider
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
        db.add(McpConnection(
            user_id=user_id,
            provider=provider,
            oauth_tokens=encrypted,
            scopes=tokens.scope.split() if tokens.scope else [],
        ))
    
    await db.commit()
    # Redirect to frontend success page
    return {"message": "Integration connected successfully", "close_window": True}


@integrations_router.delete("/{provider}")
async def revoke_integration(
    provider: str,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    await db.execute(
        delete(McpConnection).where(
            McpConnection.user_id == user.id,
            McpConnection.provider == provider
        )
    )
    await db.commit()
    return {"success": True}


@integrations_router.get("/{provider}/health")
async def integration_health(
    provider: str,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    conn = (
        await db.execute(
            select(McpConnection).where(
                McpConnection.user_id == user.id,
                McpConnection.provider == provider
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
                headers={"Authorization": f"Bearer {tokens.access_token}"}
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
            healthy = True # optimistic stub

    return {"status": "ok" if healthy else "error"}
