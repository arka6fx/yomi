"""Web sign-in with Telegram (D1), without the Login Widget or BotFather setup.

1. The browser calls ``start``: a secret token plus a 4-digit code, valid 10 min.
2. It opens ``t.me/<bot>?start=login_<token>``; the bot shows the code and the
   requesting device with Approve / Cancel buttons.
3. Approving binds the request to that Telegram account (creating a Yomi
   account on first use); the browser's ``poll`` then swaps it for a session.

The explicit confirmation (with the code the user sees on screen) is what
stops someone from sending a victim their own login link.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import utcnow_iso

REQUEST_TTL = timedelta(minutes=10)


def _expired(row: dict) -> bool:
    return str(row.get("expires_at") or "") <= utcnow_iso()


async def start(backend: D1Backend, user_agent: str, ip_address: str) -> dict[str, Any]:
    token = secrets.token_hex(16)
    code = f"{secrets.randbelow(10_000):04d}"
    expires = (datetime.now(UTC) + REQUEST_TTL).isoformat()
    await backend.store.atomic([
        backend.store.insert("telegram_login_requests", {
            "token": token,
            "code": code,
            "status": "pending",
            "user_id": None,
            "user_agent": (user_agent or "")[:300],
            "ip_address": (ip_address or "")[:64],
            "created_at": utcnow_iso(),
            "expires_at": expires,
        })
    ])
    return {"token": token, "code": code, "expiresAt": expires}


async def pending(backend: D1Backend, token: str) -> dict | None:
    row = await backend.store.fetch_one(
        "SELECT * FROM telegram_login_requests WHERE token = ? AND status = 'pending'",
        [token],
    )
    return None if row is None or _expired(row) else row


async def decide(backend: D1Backend, token: str, user_id: str | None, approve: bool) -> bool:
    """Approve (bound to ``user_id``) or cancel a pending request."""
    results = await backend.store.atomic([
        Statement(
            "UPDATE telegram_login_requests SET status = ?, user_id = ? "
            "WHERE token = ? AND status = 'pending' AND expires_at > ? RETURNING token",
            ["approved" if approve else "cancelled", user_id, token, utcnow_iso()],
        )
    ])
    return bool(results and results[0].get("results"))


async def consume(backend: D1Backend, token: str) -> tuple[str, str | None]:
    """Browser poll: ``(status, user_id)``. An approved request is used once."""
    row = await backend.store.fetch_one(
        "SELECT * FROM telegram_login_requests WHERE token = ?", [token]
    )
    if row is None:
        return "unknown", None
    if row["status"] == "approved":
        results = await backend.store.atomic([
            Statement(
                "UPDATE telegram_login_requests SET status = 'consumed' "
                "WHERE token = ? AND status = 'approved' RETURNING user_id",
                [token],
            )
        ])
        rows = results[0].get("results") if results else None
        if rows:
            return "approved", str(rows[0]["user_id"])
        return "consumed", None
    if row["status"] == "pending" and _expired(row):
        return "expired", None
    return str(row["status"]), None


def describe_device(user_agent: str) -> str:
    ua = user_agent or ""
    browser = next(
        (name for key, name in (
            ("Edg/", "Edge"), ("OPR/", "Opera"), ("Chrome/", "Chrome"),
            ("Firefox/", "Firefox"), ("Safari/", "Safari"),
        ) if key in ua),
        "a browser",
    )
    system = next(
        (name for key, name in (
            ("Windows", "Windows"), ("Android", "Android"), ("iPhone", "iPhone"),
            ("iPad", "iPad"), ("Mac OS", "Mac"), ("Linux", "Linux"),
        ) if key in ua),
        "an unknown device",
    )
    return f"{browser} on {system}"
