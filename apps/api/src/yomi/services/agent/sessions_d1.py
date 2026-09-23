"""D1-backed conversation history for agent sessions.

Replaces the process-local ``sessions.py`` dict so history survives restarts
and works across container instances. One session row per
(user, platform, chat); turns append as ``agent_messages`` rows ordered by
``rowid`` (insertion order — UUIDs carry no ordering).

Reads return the newest ``limit`` turns oldest-first, matching the shape the
agent loop consumes.
"""

from __future__ import annotations

import uuid
from typing import Any

from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import utcnow_iso

HISTORY_LIMIT = 60


async def get_or_create_session(
    backend: D1Backend, user_id: str, platform: str, chat_id: str
) -> str:
    """Newest active session id for the conversation, creating one if needed."""
    existing = await backend.store.fetch_one(
        "SELECT id FROM agent_sessions WHERE user_id = ? AND platform = ? "
        "AND chat_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
        [user_id, platform, chat_id],
    )
    if existing is not None:
        return str(existing["id"])
    session_id = str(uuid.uuid4())
    now = utcnow_iso()
    await backend.store.atomic([
        backend.store.insert_or_ignore("agent_sessions", {
            "id": session_id,
            "user_id": user_id,
            "platform": platform,
            "chat_id": chat_id,
            "title": None,
            "summary": None,
            "status": "active",
            "message_count": 0,
            "created_at": now,
            "updated_at": now,
            "last_message_at": now,
            "closed_at": None,
        })
    ])
    return session_id


async def append_turn(
    backend: D1Backend, user_id: str, platform: str, chat_id: str, role: str, content: str
) -> None:
    session_id = await get_or_create_session(backend, user_id, platform, chat_id)
    now = utcnow_iso()
    await backend.store.atomic([
        backend.store.insert("agent_messages", {
            "id": str(uuid.uuid4()),
            "session_id": session_id,
            "user_id": user_id,
            "role": role,
            "content": content,
            "metadata": None,
            "created_at": now,
        }),
        Statement(
            "UPDATE agent_sessions SET message_count = message_count + 1, "
            "last_message_at = ?, updated_at = ? WHERE id = ?",
            [now, now, session_id],
        ),
    ])


async def load_history(
    backend: D1Backend, user_id: str, platform: str, chat_id: str, limit: int = HISTORY_LIMIT
) -> list[dict[str, Any]]:
    rows = await backend.store.fetch_all(
        "SELECT m.role AS role, m.content AS content FROM agent_messages m "
        "JOIN agent_sessions s ON s.id = m.session_id "
        "WHERE s.user_id = ? AND s.platform = ? AND s.chat_id = ? AND s.status = 'active' "
        "ORDER BY m.rowid DESC LIMIT ?",
        [user_id, platform, chat_id, max(1, limit)],
    )
    return [{"role": str(row["role"]), "content": str(row["content"])} for row in reversed(rows)]


async def clear_history(backend: D1Backend, user_id: str, platform: str, chat_id: str) -> None:
    """End the conversation: drop its sessions (messages cascade)."""
    await backend.store.atomic([
        Statement(
            "DELETE FROM agent_sessions WHERE user_id = ? AND platform = ? AND chat_id = ?",
            [user_id, platform, chat_id],
        )
    ])
