"""/api/trust — Trusted people: requests, trusted list, blocks and pause (D1 only)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from yomi.app.deps import get_current_user
from yomi.db.models_auth import User
from yomi.services import trust_d1
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend

trust_router = APIRouter(prefix="/api/trust")


class RequestIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    note: str | None = Field(default=None, max_length=280)


class PauseIn(BaseModel):
    paused: bool


def _require(d1: D1Backend | None) -> D1Backend:
    if d1 is None:
        raise HTTPException(status_code=501, detail="Trusted people requires the D1 backend")
    return d1


@trust_router.get("")
async def get_trust(
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    return await trust_d1.overview(_require(d1), user.id)


@trust_router.post("/requests")
async def create_request(
    body: RequestIn,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    try:
        message = await trust_d1.request(_require(d1), user.id, body.email, body.note)
    except trust_d1.TrustError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"message": message}


@trust_router.post("/pause")
async def pause(
    body: PauseIn,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    await trust_d1.set_paused(_require(d1), user.id, body.paused)
    return {"paused": body.paused}


@trust_router.post("/{link_id}/{action}")
async def decide(
    link_id: str,
    action: Literal["accept", "decline", "block", "unblock", "remove"],
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    try:
        await trust_d1.decide(_require(d1), user.id, link_id, action)
    except trust_d1.TrustError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}
