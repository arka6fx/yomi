from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.db.models_app2 import PendingAction
from yomi.db.models_auth import User

logger = logging.getLogger(__name__)

actions_router = APIRouter(prefix="/api/actions")

@actions_router.get("/pending")
async def list_pending_actions(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(PendingAction)
            .where(
                PendingAction.user_id == user.id,
                PendingAction.status == "pending",
                PendingAction.expires_at > datetime.now(UTC)
            )
            .order_by(desc(PendingAction.created_at))
        )
    ).scalars().all()
    
    actions = [
        {
            "id": str(r.id),
            "connector": r.connector,
            "action": r.action,
            "risk": r.risk,
            "title": r.title,
            "preview": r.preview,
            "confirmText": r.confirm_text,
            "payload": r.payload,
            "expiresAt": r.expires_at,
            "createdAt": r.created_at,
        }
        for r in rows
    ]
    return {"actions": actions}


@actions_router.post("/{action_id}/approve")
async def approve_action(
    action_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    action = (
        await db.execute(
            select(PendingAction)
            .where(
                PendingAction.id == action_id,
                PendingAction.user_id == user.id,
                PendingAction.status == "pending"
            )
        )
    ).scalar_one_or_none()
    
    if not action:
        raise HTTPException(status_code=404, detail="Pending action not found or already decided")
        
    await db.execute(
        update(PendingAction)
        .where(PendingAction.id == action.id)
        .values(
            status="approved",
            decided_at=datetime.now(UTC),
            updated_at=datetime.now(UTC)
        )
    )
    await db.commit()
    
    return {"status": "approved", "id": str(action.id)}


@actions_router.post("/{action_id}/reject")
async def reject_action(
    action_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
):
    action = (
        await db.execute(
            select(PendingAction)
            .where(
                PendingAction.id == action_id,
                PendingAction.user_id == user.id,
                PendingAction.status == "pending"
            )
        )
    ).scalar_one_or_none()
    
    if not action:
        raise HTTPException(status_code=404, detail="Pending action not found or already decided")
        
    await db.execute(
        update(PendingAction)
        .where(PendingAction.id == action.id)
        .values(
            status="rejected",
            decided_at=datetime.now(UTC),
            updated_at=datetime.now(UTC)
        )
    )
    await db.commit()
    
    return {"status": "rejected", "id": str(action.id)}
