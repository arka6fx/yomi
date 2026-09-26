"""/api/computer — the user's private desktop: live view (take over) and saving logins."""

from __future__ import annotations

import hashlib
import hmac
import time
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException

from yomi.app.deps import get_current_user
from yomi.conf import settings
from yomi.db.models_auth import User

computer_router = APIRouter(prefix="/api/computer")

VIEWER_TTL_S = 10 * 60


def configured() -> bool:
    return bool(settings.computer_gateway_url and settings.computer_gateway_secret)


def viewer_token(workspace: str, now: float | None = None) -> tuple[str, int]:
    """`<exp>.<hmac>` — checked by the gateway's websocket route (apps/sandbox)."""
    exp = int((now or time.time()) + VIEWER_TTL_S)
    mac = hmac.new(
        settings.computer_gateway_secret.encode(), f"{workspace}.{exp}".encode(), hashlib.sha256
    ).hexdigest()
    return f"{exp}.{mac}", exp


def viewer_url(workspace: str, token: str) -> str:
    parts = urlsplit(settings.computer_gateway_url)
    scheme = "wss" if parts.scheme == "https" else "ws"
    base = parts.path.rstrip("/")
    return urlunsplit((scheme, parts.netloc, f"{base}/computer/{workspace}/vnc",
                       f"token={token}", ""))


def computer_page_url() -> str:
    return f"{settings.app_url.rstrip('/')}/dashboard?tab=computer"


@computer_router.get("")
async def computer_status(user: User = Depends(get_current_user)) -> dict:
    return {"available": configured(), "pageUrl": computer_page_url()}


@computer_router.post("/viewer")
async def open_viewer(user: User = Depends(get_current_user)) -> dict:
    """A short-lived websocket URL for watching and controlling the desktop."""
    if not configured():
        raise HTTPException(status_code=503, detail="The computer isn't available yet")
    token, exp = viewer_token(str(user.id))
    return {"url": viewer_url(str(user.id), token), "expiresAt": exp}


@computer_router.post("/save")
async def save_logins(user: User = Depends(get_current_user)) -> dict:
    """Keep what the user signed into, right now (it's also saved before sleep)."""
    if not configured():
        raise HTTPException(status_code=503, detail="The computer isn't available yet")
    from yomi.services.computer.client import ComputerClient, ComputerError
    from yomi.services.http_pool import shared_client

    try:
        return await ComputerClient.for_user(shared_client(), str(user.id)).save()
    except ComputerError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
