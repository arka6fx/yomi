from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.crypto import encrypt_string
from yomi.db.models_app2 import CustomMcpServer
from yomi.db.models_auth import User
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend
from yomi.services.cloudflare_storage.store import utcnow_iso

logger = logging.getLogger(__name__)

custom_mcp_router = APIRouter(prefix="/api/custom-mcp")

def _server_dict(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "url": row["url"],
        "hasApiKey": bool(row.get("api_key_encrypted")),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


@custom_mcp_router.get("")
async def list_custom_mcp_servers(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        rows = await d1.store.fetch_all(
            "SELECT * FROM custom_mcp_servers WHERE user_id = ? ORDER BY created_at ASC",
            [user.id],
        )
        return {"servers": [_server_dict(r) for r in rows]}
    rows = (
        await db.execute(
            select(CustomMcpServer)
            .where(CustomMcpServer.user_id == user.id)
            .order_by(CustomMcpServer.created_at)
        )
    ).scalars().all()
    
    servers = [
        {
            "id": str(r.id),
            "name": r.name,
            "url": r.url,
            "hasApiKey": bool(r.api_key_encrypted),
            "createdAt": r.created_at,
            "updatedAt": r.updated_at,
        }
        for r in rows
    ]
    return {"servers": servers}


@custom_mcp_router.post("")
async def create_custom_mcp_server(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
        
    name = body.get("name")
    url = body.get("url")
    api_key = body.get("apiKey")
    
    if not name or not url:
        raise HTTPException(status_code=400, detail="Name and URL are required")
        
    api_key_encrypted = encrypt_string(api_key) if api_key else None

    if d1 is not None:
        existing = await d1.store.fetch_one(
            "SELECT id FROM custom_mcp_servers WHERE user_id = ? AND url = ? LIMIT 1",
            [user.id, url],
        )
        if existing:
            raise HTTPException(status_code=400, detail="Server with this URL already exists")
        now = utcnow_iso()
        server_id = str(uuid.uuid4())
        await d1.store.atomic([
            d1.store.insert("custom_mcp_servers", {
                "id": server_id,
                "user_id": user.id,
                "name": name,
                "url": url,
                "api_key_encrypted": api_key_encrypted,
                "created_at": now,
                "updated_at": now,
            })
        ])
        return {"server": _server_dict({
            "id": server_id, "name": name, "url": url,
            "api_key_encrypted": api_key_encrypted,
            "created_at": now, "updated_at": now,
        })}
    existing = (
        await db.execute(
            select(CustomMcpServer)
            .where(CustomMcpServer.user_id == user.id, CustomMcpServer.url == url)
        )
    ).scalar_one_or_none()
    
    if existing:
        raise HTTPException(status_code=400, detail="Server with this URL already exists")
        
    server = CustomMcpServer(
        user_id=user.id,
        name=name,
        url=url,
        api_key_encrypted=api_key_encrypted
    )
    db.add(server)
    await db.commit()
    
    return {
        "server": {
            "id": str(server.id),
            "name": server.name,
            "url": server.url,
            "hasApiKey": bool(server.api_key_encrypted),
            "createdAt": server.created_at,
            "updatedAt": server.updated_at,
        }
    }


@custom_mcp_router.patch("/{server_id}")
async def update_custom_mcp_server(
    server_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    if d1 is not None:
        server = await d1.store.fetch_one(
            "SELECT * FROM custom_mcp_servers WHERE id = ? AND user_id = ? LIMIT 1",
            [server_id, user.id],
        )
        if not server:
            raise HTTPException(status_code=404, detail="Server not found")
        values_to_update: dict[str, Any] = {"updated_at": utcnow_iso()}
        if "name" in body:
            values_to_update["name"] = body["name"]
        if "url" in body:
            values_to_update["url"] = body["url"]
        if "apiKey" in body:
            values_to_update["api_key_encrypted"] = (
                None if body["apiKey"] is None else encrypt_string(body["apiKey"])
            )
        assignments = ", ".join(f"{key} = ?" for key in values_to_update)
        await d1.store.atomic([
            Statement(
                f"UPDATE custom_mcp_servers SET {assignments} WHERE id = ?",
                [*values_to_update.values(), server_id],
            )
        ])
        return {"status": "updated", "id": str(server["id"])}
    server = (
        await db.execute(
            select(CustomMcpServer)
            .where(CustomMcpServer.id == server_id, CustomMcpServer.user_id == user.id)
        )
    ).scalar_one_or_none()
    
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
        
    values_to_update: dict[str, Any] = {"updated_at": datetime.now(UTC)}
    
    if "name" in body:
        values_to_update["name"] = body["name"]
    if "url" in body:
        values_to_update["url"] = body["url"]
    if "apiKey" in body:
        if body["apiKey"] is None:
            values_to_update["api_key_encrypted"] = None
        else:
            values_to_update["api_key_encrypted"] = encrypt_string(body["apiKey"])
            
    if values_to_update:
        await db.execute(
            update(CustomMcpServer)
            .where(CustomMcpServer.id == server.id)
            .values(**values_to_update)
        )
        await db.commit()
        
    return {"status": "updated", "id": str(server.id)}


@custom_mcp_router.delete("/{server_id}")
async def delete_custom_mcp_server(
    server_id: str,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        await d1.store.atomic([
            Statement(
                "DELETE FROM custom_mcp_servers WHERE id = ? AND user_id = ?",
                [server_id, user.id],
            )
        ])
        return {"status": "deleted"}
    await db.execute(
        delete(CustomMcpServer)
        .where(CustomMcpServer.id == server_id, CustomMcpServer.user_id == user.id)
    )
    await db.commit()
    return {"status": "deleted"}
