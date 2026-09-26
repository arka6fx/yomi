from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.db.models_app import AgentMessage, AgentSession
from yomi.db.models_auth import User
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend

logger = logging.getLogger(__name__)

history_router = APIRouter(prefix="/api/history")

@history_router.get("")
async def get_history(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    session_id = request.query_params.get("sessionId")
    limit = int(request.query_params.get("limit", "50"))
    limit = min(limit, 100)

    if d1 is not None:
        if session_id:
            valid = await d1.store.fetch_one(
                "SELECT id FROM agent_sessions WHERE id = ? AND user_id = ? LIMIT 1",
                [session_id, user.id],
            )
            if valid is None:
                raise HTTPException(status_code=404, detail="Session not found")
            rows = await d1.store.fetch_all(
                "SELECT * FROM agent_messages WHERE session_id = ? AND user_id = ? "
                "ORDER BY created_at DESC LIMIT ?",
                [session_id, user.id, limit],
            )
        else:
            rows = await d1.store.fetch_all(
                "SELECT * FROM agent_messages WHERE user_id = ? "
                "ORDER BY created_at DESC LIMIT ?",
                [user.id, limit],
            )
        messages = []
        for r in rows:
            metadata = r.get("metadata")
            if isinstance(metadata, str) and metadata:
                try:
                    metadata = json.loads(metadata)
                except ValueError:
                    metadata = None
            messages.append(
                {
                    "id": str(r["id"]),
                    "sessionId": str(r["session_id"]),
                    "role": r["role"],
                    "content": r["content"],
                    "metadata": metadata,
                    "createdAt": r.get("created_at"),
                }
            )
        return {"messages": messages}
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


def _require_d1(d1: D1Backend | None) -> D1Backend:
    if d1 is None:
        raise HTTPException(status_code=501, detail="History requires the D1 storage backend")
    return d1


@history_router.get("/sessions")
async def list_history_sessions(
    request: Request,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    """Past and current conversations for the dashboard's history view."""
    from yomi.services.agent import sessions_d1

    backend = _require_d1(d1)
    try:
        limit = int(request.query_params.get("limit", "20"))
    except ValueError:
        limit = 20
    query = (request.query_params.get("q") or "").strip()[:200] or None
    cursor = request.query_params.get("cursor") or None
    sessions = await sessions_d1.list_sessions(
        backend, user.id, limit=limit, query=query, before=cursor
    )
    return {"sessions": sessions}


@history_router.get("/sessions/{session_id}")
async def get_history_session(
    session_id: str,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    from yomi.services.agent import sessions_d1

    detail = await sessions_d1.get_session_detail(_require_d1(d1), user.id, session_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return detail
