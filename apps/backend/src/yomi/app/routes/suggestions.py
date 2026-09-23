from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request

from yomi.app.deps import get_current_user
from yomi.db.models_auth import User

logger = logging.getLogger(__name__)

suggestions_router = APIRouter(prefix="/api/suggestions")

@suggestions_router.get("")
async def get_suggestions(
    request: Request,
    user: User = Depends(get_current_user),
):
    # Port of apps/backend/src/routes/suggestions.ts
    # In a full implementation, this might call an LLM
    # or query the database for dynamic suggestions based on user context.
    
    # Returning a static list of suggestions for now.
    suggestions = [
        {
            "id": "1",
            "title": "Summarize latest emails",
            "prompt": "Can you summarize my unread emails from today?",
            "icon": "mail"
        },
        {
            "id": "2",
            "title": "Review calendar",
            "prompt": "What's on my schedule for tomorrow?",
            "icon": "calendar"
        },
        {
            "id": "3",
            "title": "Draft a weekly report",
            "prompt": "Help me draft a weekly update report based on my tasks.",
            "icon": "edit"
        }
    ]
    
    return {"suggestions": suggestions}
