from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.db.models_app import AgentSession
from yomi.db.models_auth import User

logger = logging.getLogger(__name__)

conversation_router = APIRouter(prefix="/api/conversation")

@conversation_router.get("")
async def get_conversations(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    limit = int(request.query_params.get("limit", "50"))
    limit = min(limit, 100)
    
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
):
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
