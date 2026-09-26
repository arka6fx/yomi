"""One-click unsubscribe from onboarding and win-back emails."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse

from yomi.services import lifecycle_d1
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend

lifecycle_router = APIRouter(prefix="/api/lifecycle")

PAGE = (
    '<!doctype html><html><head><meta name="viewport" content="width=device-width">'
    "<title>yomi</title></head><body style=\"margin:0;display:grid;place-items:center;"
    "min-height:100vh;background:#eef3f8;font-family:-apple-system,BlinkMacSystemFont,"
    "'Segoe UI',Roboto,sans-serif;color:#1d1b18\"><p style=\"font-size:18px;padding:24px;"
    'text-align:center">{message}</p></body></html>'
)


@lifecycle_router.api_route("/unsubscribe", methods=["GET", "POST"])
async def unsubscribe(
    u: str = Query(""),
    t: str = Query(""),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    # POST is the mail client's one-click unsubscribe (RFC 8058); GET is the link.
    if d1 is None or not lifecycle_d1.valid_unsubscribe(u, t):
        return HTMLResponse(PAGE.format(message="that link doesn't work any more."), 400)
    await lifecycle_d1.opt_out(d1, u)
    return HTMLResponse(PAGE.format(message="done. no more tips from yomi 👋"))
