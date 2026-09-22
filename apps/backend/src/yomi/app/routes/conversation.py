from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.db.models_app import AgentSession
from yomi.db.models_auth import User
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend

logger = logging.getLogger(__name__)

conversation_router = APIRouter(prefix="/api/conversation")

@conversation_router.get("")
async def get_conversations(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    limit = int(request.query_params.get("limit", "50"))
    limit = min(limit, 100)

    if d1 is not None:
        rows = await d1.store.fetch_all(
            "SELECT * FROM agent_sessions WHERE user_id = ? "
            "ORDER BY last_message_at DESC LIMIT ?",
            [user.id, limit],
        )
        return {
            "conversations": [
                {
                    "id": str(r["id"]),
                    "platform": r["platform"],
                    "chatId": r["chat_id"],
                    "title": r.get("title"),
                    "summary": r.get("summary"),
                    "status": r["status"],
                    "messageCount": r.get("message_count"),
                    "lastMessageAt": r.get("last_message_at"),
                    "createdAt": r.get("created_at"),
                }
                for r in rows
            ]
        }
    rows = (
        await db.execute(
            select(AgentSession)
            .where(AgentSession.user_id == user.id)
            .order_by(desc(AgentSession.last_message_at))
            .limit(limit)
        )
    ).scalars().all()
    
    conversations = [
        {
            "id": str(r.id),
            "platform": r.platform,
            "chatId": r.chat_id,
            "title": r.title,
            "summary": r.summary,
            "status": r.status,
            "messageCount": r.message_count,
            "lastMessageAt": r.last_message_at,
            "createdAt": r.created_at,
        }
        for r in rows
    ]
    return {"conversations": conversations}


@conversation_router.get("/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        row = await d1.store.fetch_one(
            "SELECT * FROM agent_sessions WHERE id = ? AND user_id = ? LIMIT 1",
            [conversation_id, user.id],
        )
        if not row:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return {
            "conversation": {
                "id": str(row["id"]),
                "platform": row["platform"],
                "chatId": row["chat_id"],
                "title": row.get("title"),
                "summary": row.get("summary"),
                "status": row["status"],
                "messageCount": row.get("message_count"),
                "lastMessageAt": row.get("last_message_at"),
                "createdAt": row.get("created_at"),
            }
        }
    row = (
        await db.execute(
            select(AgentSession)
            .where(
                AgentSession.id == conversation_id,
                AgentSession.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    
    if not row:
        raise HTTPException(status_code=404, detail="Conversation not found")
        
    return {
        "conversation": {
            "id": str(row.id),
            "platform": row.platform,
            "chatId": row.chat_id,
            "title": row.title,
            "summary": row.summary,
            "status": row.status,
            "messageCount": row.message_count,
            "lastMessageAt": row.last_message_at,
            "createdAt": row.created_at,
        }
    }
