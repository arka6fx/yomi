"""Trusted people on D1: Yomi users whose agents may message each other.

Each unordered pair of users has at most one ``trust_links`` row:

- ``pending``  requester asked target; the target accepts or declines.
- ``trusted``  mutual; either side's agent may message the other.
- ``blocked``  stored as (blocked person -> blocker). The blocked person's
  requests are silently dropped.

Messages are delivered to the recipient's Telegram and kept in
``trust_messages`` so the recipient's agent can read and answer them. A
paused user sends and receives nothing. Requests never reveal whether an
email belongs to a Yomi user.
"""

from __future__ import annotations

from typing import Any

from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import new_id, utcnow_iso
from yomi.services.notify_d1 import notify_user

MAX_MESSAGE_CHARS = 2000
REQUEST_SENT = "If they use Yomi, they'll get your request on Telegram."


class TrustError(ValueError):
    """A refused trusted-people operation, safe to show the user."""


async def _name(backend: D1Backend, user_id: str) -> str:
    row = await backend.store.fetch_one('SELECT name, email FROM "user" WHERE id = ?', [user_id])
    if not row:
        return "Someone"
    return str(row.get("name") or row.get("email") or "Someone")


async def is_paused(backend: D1Backend, user_id: str) -> bool:
    row = await backend.store.fetch_one(
        "SELECT paused FROM trust_settings WHERE user_id = ?", [user_id]
    )
    return bool(row and int(row.get("paused") or 0))


async def set_paused(backend: D1Backend, user_id: str, paused: bool) -> None:
    await backend.store.atomic([
        Statement(
            "INSERT INTO trust_settings (user_id, paused, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET paused = excluded.paused, "
            "updated_at = excluded.updated_at",
            [user_id, int(paused), utcnow_iso()],
        )
    ])


async def _pair(backend: D1Backend, a: str, b: str) -> dict | None:
    return await backend.store.fetch_one(
        "SELECT * FROM trust_links WHERE (requester_id = ? AND target_id = ?) "
        "OR (requester_id = ? AND target_id = ?) LIMIT 1",
        [a, b, b, a],
    )


async def request(backend: D1Backend, user_id: str, email: str, note: str | None = None) -> str:
    """Ask another Yomi user (by email) to become a trusted person."""
    if await is_paused(backend, user_id):
        raise TrustError("Your connections are paused. Resume them first.")
    target = await backend.store.fetch_one(
        'SELECT id FROM "user" WHERE lower(email) = lower(?) LIMIT 1', [email.strip()]
    )
    if target is None or str(target["id"]) == user_id:
        return REQUEST_SENT
    target_id = str(target["id"])
    link = await _pair(backend, user_id, target_id)
    now = utcnow_iso()
    if link is not None:
        if link["status"] == "trusted":
            raise TrustError("You already trust each other.")
        if link["status"] == "blocked":
            if link["target_id"] == user_id:
                raise TrustError("You blocked this person. Unblock them first.")
            return REQUEST_SENT  # they blocked you: say nothing
        if link["requester_id"] == user_id:
            return REQUEST_SENT  # already pending
        # They already asked you: asking back is accepting.
        await backend.store.atomic([
            Statement(
                "UPDATE trust_links SET status = 'trusted', decided_at = ? WHERE id = ?",
                [now, link["id"]],
            )
        ])
        await notify_user(
            backend, target_id,
            f"🤝 {await _name(backend, user_id)} accepted your trusted-person request.",
        )
        return "You now trust each other."

    await backend.store.atomic([
        backend.store.insert("trust_links", {
            "id": new_id(),
            "requester_id": user_id,
            "target_id": target_id,
            "status": "pending",
            "note": (note or "").strip()[:280] or None,
            "created_at": now,
            "decided_at": None,
        })
    ])
    if not await is_paused(backend, target_id):
        await notify_user(
            backend, target_id,
            f"🤝 {await _name(backend, user_id)} wants to connect their Yomi to yours. "
            "Accept or decline in the dashboard under Trusted people.",
        )
    return REQUEST_SENT


async def overview(backend: D1Backend, user_id: str) -> dict[str, Any]:
    rows = await backend.store.fetch_all(
        "SELECT l.*, "
        "CASE WHEN l.requester_id = ? THEN l.target_id ELSE l.requester_id END AS other_id, "
        "u.name AS other_name, u.email AS other_email "
        "FROM trust_links l JOIN \"user\" u ON u.id = "
        "(CASE WHEN l.requester_id = ? THEN l.target_id ELSE l.requester_id END) "
        "WHERE l.requester_id = ? OR l.target_id = ? ORDER BY l.created_at DESC",
        [user_id, user_id, user_id, user_id],
    )
    groups: dict[str, list[dict]] = {"requests": [], "sent": [], "trusted": [], "blocked": []}
    for row in rows:
        person = {
            "id": str(row["id"]),
            "personId": str(row["other_id"]),
            "name": row.get("other_name") or row.get("other_email"),
            "email": row.get("other_email"),
            "note": row.get("note"),
            "since": row.get("decided_at") or row.get("created_at"),
        }
        status, mine = row["status"], row["requester_id"] == user_id
        if status == "trusted":
            groups["trusted"].append(person)
        elif status == "pending":
            groups["sent" if mine else "requests"].append(person)
        elif status == "blocked" and not mine:
            groups["blocked"].append(person)
    return {**groups, "paused": await is_paused(backend, user_id)}


async def _owned(backend: D1Backend, user_id: str, link_id: str) -> dict:
    link = await backend.store.fetch_one(
        "SELECT * FROM trust_links WHERE id = ? AND (requester_id = ? OR target_id = ?)",
        [link_id, user_id, user_id],
    )
    if link is None:
        raise TrustError("Not found")
    return link


async def decide(backend: D1Backend, user_id: str, link_id: str, action: str) -> None:
    """accept | decline | block | unblock | remove, from ``user_id``'s side."""
    link = await _owned(backend, user_id, link_id)
    other = link["target_id"] if link["requester_id"] == user_id else link["requester_id"]
    incoming_pending = link["status"] == "pending" and link["target_id"] == user_id
    now = utcnow_iso()

    if action == "accept" and incoming_pending:
        await backend.store.atomic([
            Statement(
                "UPDATE trust_links SET status = 'trusted', decided_at = ? WHERE id = ?",
                [now, link_id],
            )
        ])
        await notify_user(
            backend, str(other),
            f"🤝 {await _name(backend, user_id)} accepted your trusted-person request.",
        )
    elif (action == "decline" and incoming_pending) or (
        action == "remove" and link["status"] in ("trusted", "pending")
    ):
        await backend.store.atomic([
            Statement("DELETE FROM trust_links WHERE id = ?", [link_id])
        ])
    elif action == "block" and link["status"] != "blocked":
        await backend.store.atomic([
            Statement("DELETE FROM trust_links WHERE id = ?", [link_id]),
            backend.store.insert("trust_links", {
                "id": new_id(),
                "requester_id": str(other),
                "target_id": user_id,
                "status": "blocked",
                "note": None,
                "created_at": now,
                "decided_at": now,
            }),
        ])
    elif action == "unblock" and link["status"] == "blocked" and link["target_id"] == user_id:
        await backend.store.atomic([
            Statement("DELETE FROM trust_links WHERE id = ?", [link_id])
        ])
    else:
        raise TrustError(f"Can't {action} this connection")


async def trusted_people(backend: D1Backend, user_id: str) -> list[dict[str, str]]:
    data = await overview(backend, user_id)
    return [{"id": p["personId"], "name": str(p["name"])} for p in data["trusted"]]


async def send_message(
    backend: D1Backend,
    sender_id: str,
    recipient_id: str,
    body: str,
    reply_to: str | None = None,
) -> dict[str, Any]:
    body = (body or "").strip()
    if not body:
        raise TrustError("message is empty")
    if await is_paused(backend, sender_id):
        raise TrustError("Your connections are paused.")
    link = await _pair(backend, sender_id, recipient_id)
    if link is None or link["status"] != "trusted":
        raise TrustError("You can only message people you both trust.")
    if await is_paused(backend, recipient_id):
        raise TrustError("They have paused connections right now.")
    message_id = new_id()
    await backend.store.atomic([
        backend.store.insert("trust_messages", {
            "id": message_id,
            "sender_id": sender_id,
            "recipient_id": recipient_id,
            "body": body[:MAX_MESSAGE_CHARS],
            "reply_to": reply_to,
            "read_at": None,
            "created_at": utcnow_iso(),
        })
    ])
    await notify_user(
        backend, recipient_id,
        f"💬 From {await _name(backend, sender_id)}'s Yomi:\n\n{body[:MAX_MESSAGE_CHARS]}\n\n"
        "Reply here and I'll pass it back.",
    )
    return {"ok": True, "message_id": message_id}


async def inbox(backend: D1Backend, user_id: str, limit: int = 20) -> list[dict[str, Any]]:
    rows = await backend.store.fetch_all(
        "SELECT m.*, u.name AS sender_name FROM trust_messages m "
        "JOIN \"user\" u ON u.id = m.sender_id "
        "WHERE m.recipient_id = ? ORDER BY m.created_at DESC LIMIT ?",
        [user_id, limit],
    )
    unread = [str(r["id"]) for r in rows if not r.get("read_at")]
    if unread:
        placeholders = ", ".join("?" for _ in unread)
        await backend.store.atomic([
            Statement(
                f"UPDATE trust_messages SET read_at = ? WHERE id IN ({placeholders})",
                [utcnow_iso(), *unread],
            )
        ])
    return [
        {
            "id": str(r["id"]),
            "from": {"id": str(r["sender_id"]), "name": r.get("sender_name")},
            "body": r["body"],
            "replyTo": r.get("reply_to"),
            "unread": not r.get("read_at"),
            "at": r.get("created_at"),
        }
        for r in rows
    ]
