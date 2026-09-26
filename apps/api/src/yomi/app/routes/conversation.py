from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
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


@conversation_router.get("/shared")
async def get_shared_conversation(
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    """The live thread Yomi is replying in (Telegram), recent turns oldest-first."""
    from yomi.services.agent import sessions_d1

    if d1 is None:
        raise HTTPException(status_code=501, detail="Requires the D1 storage backend")
    return {"history": await sessions_d1.load_shared_thread(d1, user.id)}


@conversation_router.post("/shared/reset")
async def reset_shared_conversation(
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    """Start fresh: the current thread moves to history and Yomi forgets its context."""
    from yomi.services.agent import sessions_d1

    if d1 is None:
        raise HTTPException(status_code=501, detail="Requires the D1 storage backend")
    await sessions_d1.close_sessions(d1, user.id)
    return {"ok": True}


class SendIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@conversation_router.post("/shared/send")
async def send_to_shared_conversation(
    body: SendIn,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    """Text Yomi from the dashboard. The message joins the same thread as Telegram,
    so either place picks up where the other left off."""
    import asyncio

    from yomi.gateway.telegram import get_lock
    from yomi.services import billing_d1, connectors_d1
    from yomi.services.agent import sessions_d1
    from yomi.services.agent.loop import run_agent_loop
    from yomi.services.metering import ChargeInput

    if d1 is None:
        raise HTTPException(status_code=501, detail="Requires the D1 storage backend")
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Say something first")
    user_id = str(user.id)
    plan = getattr(user, "plan", None) or "explore"
    platform, chat_id = await sessions_d1.live_thread(d1, user_id)
    # One turn at a time per chat, whether it came from Telegram or here.
    async with get_lock(chat_id):
        metering = {"id": user_id, "plan": plan, "subscription_status": "active"}
        charged = await billing_d1.charge_usage(
            d1, ChargeInput(user=metering, kind="chat", units=1)  # type: ignore[arg-type]
        )
        if not charged.ok:
            raise HTTPException(status_code=402, detail=charged.message)
        history = await sessions_d1.load_history(d1, user_id, platform, chat_id)
        await sessions_d1.append_turn(d1, user_id, platform, chat_id, "user", text)
        history.append({"role": "user", "content": text})
        pending = connectors_d1.create_pending_action(
            d1, user_id=user_id, source_platform=platform, source_chat_id=chat_id
        )
        try:
            reply = await asyncio.wait_for(
                run_agent_loop(
                    history, user_id, plan, db_session=None,
                    create_pending_action=pending, d1=d1,
                ),
                timeout=120.0,
            )
        except TimeoutError as exc:
            raise HTTPException(status_code=504, detail="Yomi took too long; try again") from exc
        reply = (reply or "").strip()
        await sessions_d1.append_turn(d1, user_id, platform, chat_id, "assistant", reply)
    return {"reply": {"role": "assistant", "content": reply}}


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
