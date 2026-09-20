from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.db.models_app import AgentMessage, AgentSession
from yomi.db.models_auth import User

logger = logging.getLogger(__name__)

history_router = APIRouter(prefix="/api/history")

@history_router.get("")
async def get_history(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    session_id = request.query_params.get("sessionId")
    limit = int(request.query_params.get("limit", "50"))
    limit = min(limit, 100)
    
    if session_id:
        # Validate session belongs to user
        session_valid = (
            await db.execute(
                select(AgentSession.id)
                .where(
                    AgentSession.id == session_id,
                    AgentSession.user_id == user.id
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        
        if not session_valid:
            raise HTTPException(status_code=404, detail="Session not found")
            
        where_clause = [AgentMessage.session_id == session_id, AgentMessage.user_id == user.id]
    else:
        where_clause = [AgentMessage.user_id == user.id]
        
    rows = (
        await db.execute(
            select(AgentMessage)
            .where(*where_clause)
            .order_by(desc(AgentMessage.created_at))
            .limit(limit)
        )
    ).scalars().all()
    
    # Return in reverse chronological order as queried, or we can reverse it for chron
    # Often history routes return oldest first or paginated. We'll leave as queried.
    messages = [
        {
            "id": str(r.id),
            "sessionId": str(r.session_id),
            "role": r.role,
            "content": r.content,
            "metadata": r.metadata_,
            "createdAt": r.created_at,
        }
        for r in rows
    ]
    return {"messages": messages}
