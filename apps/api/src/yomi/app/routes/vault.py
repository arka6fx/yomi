"""/api/vault — the user's Vault (logins, cards, personal info, agent items)
and the spend ledger of agent payments. D1 only; secrets are write-only here.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from yomi.app.deps import get_current_user
from yomi.db.models_auth import User
from yomi.services import vault_d1
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend

vault_router = APIRouter(prefix="/api/vault")


class VaultItemIn(BaseModel):
    kind: str
    label: str = Field(max_length=80)
    fields: dict[str, Any] = Field(default_factory=dict)


def _require(d1: D1Backend | None) -> D1Backend:
    if d1 is None:
        raise HTTPException(status_code=501, detail="The Vault requires the D1 storage backend")
    return d1


@vault_router.get("/items")
async def list_vault_items(
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    return {"items": await vault_d1.list_items(_require(d1), user.id)}


@vault_router.post("/items", status_code=201)
async def create_vault_item(
    body: VaultItemIn,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if body.kind == "agent_item":
        raise HTTPException(status_code=400, detail="Agent items are created by your agent")
    try:
        item = await vault_d1.create_item(_require(d1), user.id, body.kind, body.label, body.fields)
    except vault_d1.VaultError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"item": item}


@vault_router.delete("/items/{item_id}")
async def delete_vault_item(
    item_id: str,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if not await vault_d1.delete_item(_require(d1), user.id, item_id):
        raise HTTPException(status_code=404, detail="Vault item not found")
    return {"ok": True}


@vault_router.get("/payments")
async def list_vault_payments(
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    from yomi.services import email_d1

    backend = _require(d1)
    ledger = await vault_d1.list_payments(backend, user.id)
    return {**ledger, "receipts": await email_d1.expenses(backend, user.id)}
