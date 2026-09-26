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


async def close_sessions(
    backend: D1Backend,
    user_id: str,
    platform: str | None = None,
    chat_id: str | None = None,
) -> None:
    """Wrap up active conversations so the next message starts fresh.

    Closed sessions keep their messages and show up in the dashboard history;
    deleting them is the privacy page's job.
    """
    now = utcnow_iso()
    sql = (
        "UPDATE agent_sessions SET status = 'closed', closed_at = ?, updated_at = ? "
        "WHERE user_id = ? AND status = 'active'"
    )
    params: list[Any] = [now, now, user_id]
    if platform is not None:
        sql += " AND platform = ?"
        params.append(platform)
    if chat_id is not None:
        sql += " AND chat_id = ?"
        params.append(chat_id)
    await backend.store.atomic([Statement(sql, params)])


# --- Dashboard reads -------------------------------------------------------

TITLE_CHARS = 60
SESSION_MESSAGE_CAP = 500


def _derive_title(text: str | None) -> str | None:
    if not text:
        return None
    line = " ".join(str(text).split())
    if line.startswith("[Scheduled task:"):
        line = line.split("]", 1)[-1].strip() or line
    return line if len(line) <= TITLE_CHARS else line[: TITLE_CHARS - 1].rstrip() + "…"


def _like(term: str) -> str:
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


async def list_sessions(
    backend: D1Backend,
    user_id: str,
    *,
    limit: int = 20,
    query: str | None = None,
    before: str | None = None,
) -> list[dict[str, Any]]:
    """The user's conversations, newest first, each with its latest message."""
    where = ["s.user_id = ?", "s.message_count > 0"]
    params: list[Any] = [user_id]
    if before:
        where.append("s.last_message_at < ?")
        params.append(before)
    if query:
        pattern = _like(query)
        where.append(
            "(s.title LIKE ? ESCAPE '\\' OR s.summary LIKE ? ESCAPE '\\' OR EXISTS ("
            "SELECT 1 FROM agent_messages q WHERE q.session_id = s.id "
            "AND q.content LIKE ? ESCAPE '\\'))"
        )
        params.extend([pattern, pattern, pattern])
    params.append(max(1, min(limit, 100)))
    rows = await backend.store.fetch_all(
        "SELECT s.id, s.title, s.summary, s.platform, s.status, s.message_count, "
        "s.last_message_at, s.closed_at, "
        "(SELECT m.role FROM agent_messages m WHERE m.session_id = s.id "
        " ORDER BY m.rowid DESC LIMIT 1) AS last_role, "
        "(SELECT m.content FROM agent_messages m WHERE m.session_id = s.id "
        " ORDER BY m.rowid DESC LIMIT 1) AS last_content, "
        "(SELECT m.content FROM agent_messages m WHERE m.session_id = s.id "
        " AND m.role = 'user' ORDER BY m.rowid LIMIT 1) AS first_user "
        f"FROM agent_sessions s WHERE {' AND '.join(where)} "
        # rowid breaks ties: two threads touched in the same instant (a coarse clock,
        # or a reset followed straight away by a new message) still list newest first.
        "ORDER BY s.last_message_at DESC, s.rowid DESC LIMIT ?",
        params,
    )
    return [
        {
            "id": str(r["id"]),
            "title": r.get("title") or _derive_title(r.get("first_user")),
            "summary": r.get("summary"),
            "platform": r.get("platform"),
            "active": r.get("status") == "active",
            "messageCount": int(r.get("message_count") or 0),
            "lastMessageAt": r.get("last_message_at"),
            "closedAt": r.get("closed_at"),
            "lastMessage": (
                {"role": str(r["last_role"]), "content": str(r["last_content"])}
                if r.get("last_role") is not None
                else None
            ),
        }
        for r in rows
    ]


async def get_session_detail(
    backend: D1Backend, user_id: str, session_id: str
) -> dict[str, Any] | None:
    """One conversation with its messages oldest-first, or None if not the user's."""
    session = await backend.store.fetch_one(
        "SELECT * FROM agent_sessions WHERE id = ? AND user_id = ? LIMIT 1",
        [session_id, user_id],
    )
    if session is None:
        return None
    rows = await backend.store.fetch_all(
        "SELECT role, content, created_at FROM agent_messages "
        "WHERE session_id = ? AND user_id = ? ORDER BY rowid DESC LIMIT ?",
        [session_id, user_id, SESSION_MESSAGE_CAP],
    )
    messages = [
        {"role": str(r["role"]), "content": str(r["content"]), "createdAt": r.get("created_at")}
        for r in reversed(rows)
    ]
    first_user = next((m["content"] for m in messages if m["role"] == "user"), None)
    return {
        "id": str(session["id"]),
        "title": session.get("title") or _derive_title(first_user),
        "summary": session.get("summary"),
        "platform": session.get("platform"),
        "active": session.get("status") == "active",
        "lastMessageAt": session.get("last_message_at"),
        "closedAt": session.get("closed_at"),
        "messages": messages,
    }


async def load_shared_thread(
    backend: D1Backend, user_id: str, limit: int = HISTORY_LIMIT
) -> list[dict[str, Any]]:
    """Recent turns of the user's live conversation (the one Yomi is replying in)."""
    latest = await backend.store.fetch_one(
        "SELECT id FROM agent_sessions WHERE user_id = ? AND status = 'active' "
        "ORDER BY last_message_at DESC LIMIT 1",
        [user_id],
    )
    if latest is None:
        return []
    rows = await backend.store.fetch_all(
        "SELECT role, content, created_at FROM agent_messages WHERE session_id = ? "
        "ORDER BY rowid DESC LIMIT ?",
        [latest["id"], max(1, limit)],
    )
    return [
        {"role": str(r["role"]), "content": str(r["content"]), "createdAt": r.get("created_at")}
        for r in reversed(rows)
    ]
