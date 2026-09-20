from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.crypto import encrypt_string
from yomi.db.models_app2 import CustomMcpServer
from yomi.db.models_auth import User

logger = logging.getLogger(__name__)

custom_mcp_router = APIRouter(prefix="/api/custom-mcp")

@custom_mcp_router.get("")
async def list_custom_mcp_servers(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
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
):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
        
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
):
    await db.execute(
        delete(CustomMcpServer)
        .where(CustomMcpServer.id == server_id, CustomMcpServer.user_id == user.id)
    )
    await db.commit()
    return {"status": "deleted"}
