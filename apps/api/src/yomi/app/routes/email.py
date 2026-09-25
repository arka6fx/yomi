"""/api/email — the user's Yomi email address and inbox (D1 only), plus the
internal endpoint the Worker's ``email()`` handler posts raw messages to."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from yomi.app.deps import get_current_user
from yomi.app.routes.ops import _authorized
from yomi.db.models_auth import User
from yomi.services import email_d1
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend

email_router = APIRouter()

MAX_RAW_BYTES = 5 * 1024 * 1024


def _require(d1: D1Backend | None) -> D1Backend:
    if d1 is None:
        raise HTTPException(status_code=501, detail="Email requires the D1 storage backend")
    return d1


@email_router.get("/api/email")
async def get_email(
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    backend = _require(d1)
    alias = await email_d1.get_or_create_alias(backend, user.id)
    return {
        "address": email_d1.address_for(alias),
        "emails": await email_d1.inbox(backend, user.id),
    }


@email_router.get("/api/email/{email_id}")
async def get_email_message(
    email_id: str,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    message = await email_d1.read(_require(d1), user.id, email_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Email not found")
    return message


@email_router.post("/internal/inbound-email")
async def inbound_email(request: Request, d1: D1Backend | None = Depends(get_d1_backend)):
    """Raw RFC 822 body; ``x-yomi-to`` carries the envelope recipient."""
    if not _authorized(request):
        raise HTTPException(status_code=403, detail="forbidden")
    raw = await request.body()
    if len(raw) > MAX_RAW_BYTES:
        raise HTTPException(status_code=413, detail="message too large")
    to_addr = request.headers.get("x-yomi-to", "")
    outcome = await email_d1.ingest(_require(d1), to_addr, raw)
    if outcome == "unknown":
        raise HTTPException(status_code=404, detail="unknown recipient")
    return {"status": outcome}
