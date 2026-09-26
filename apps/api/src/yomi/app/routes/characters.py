"""/api/characters — make, discover and switch the persona that answers (D1 only)."""

from __future__ import annotations

import json
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from yomi.app.deps import get_current_user
from yomi.db.models_auth import User
from yomi.services import billing_d1, characters_d1
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend
from yomi.services.metering import ChargeInput

characters_router = APIRouter(prefix="/api/characters")

TEMPLATES = {
    "companion": "a warm, attentive friend who remembers the little things",
    "tutor": "a patient teacher who explains step by step and checks understanding",
    "roleplay": "a character who runs an immersive scene and ends messages with a choice",
    "coach": "an energetic coach who turns goals into plans and checks in",
    "storyteller": "a vivid narrator who tells short serialized stories",
    "comedian": "a quick-witted friend who answers everything with a joke first",
    "language partner": "a friendly partner who chats in the target language and corrects gently",
}


def _require(d1: D1Backend | None) -> D1Backend:
    if d1 is None:
        raise HTTPException(status_code=501, detail="Characters require the D1 storage backend")
    return d1


async def _json(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


async def _telegram_chat(backend: D1Backend, user_id: str) -> str | None:
    row = await backend.store.fetch_one(
        "SELECT platform_chat_id FROM platform_connections WHERE user_id = ? "
        "AND platform = 'telegram' AND platform_chat_id IS NOT NULL LIMIT 1",
        [user_id],
    )
    return str(row["platform_chat_id"]) if row else None


async def say_first_line(backend: D1Backend, user_id: str, character: dict[str, Any]) -> bool:
    """The character texts first: send its opening line and keep it in the thread."""
    if not character.get("textsFirst", True) or not character.get("firstLines"):
        return False
    chat_id = await _telegram_chat(backend, user_id)
    if chat_id is None:
        return False
    from yomi.gateway.telegram import send_message
    from yomi.services.agent import sessions_d1

    line = character["firstLines"][0]
    await sessions_d1.append_turn(backend, user_id, "telegram", chat_id, "assistant", line)
    await send_message(chat_id, f"{character['emoji']} *{character['name']}*\n{line}")
    return True


@characters_router.get("")
async def list_characters(
    user: User = Depends(get_current_user), d1: D1Backend | None = Depends(get_d1_backend)
):
    backend = _require(d1)
    saved = await characters_d1.saved_ids(backend, user.id)
    active = await characters_d1.active(backend, user.id)
    settings = await characters_d1.settings_by_id(backend, user.id)
    stats = await characters_d1.gallery_stats(backend, user.id)

    def dress(characters: list) -> list:
        return characters_d1.apply_stats(characters_d1.apply_settings(characters, settings), stats)

    return {
        "mine": dress(await characters_d1.list_mine(backend, user.id)),
        "saved": dress([characters_d1.gallery_character(cid) for cid in saved]),
        "gallery": dress(characters_d1.gallery()),
        "active": active,
        "tags": characters_d1.TAGS,
        "templates": list(TEMPLATES),
    }


@characters_router.get("/lookup")
async def lookup_character(q: str = "", user: User = Depends(get_current_user)):
    """Find a character from an existing work (AniList, TVMaze) to prefill the maker."""
    from yomi.services.character_lookup import lookup

    return {"results": await lookup(q)}


@characters_router.post("")
async def create_character(
    request: Request,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    try:
        created = await characters_d1.create(_require(d1), user.id, await _json(request))
        return {"character": created}
    except characters_d1.CharacterError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@characters_router.put("/{character_id}")
async def update_character(
    character_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    try:
        updated = await characters_d1.update(
            _require(d1), user.id, character_id, await _json(request)
        )
    except characters_d1.CharacterError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if updated is None:
        raise HTTPException(status_code=404, detail="character not found")
    return {"character": updated}


@characters_router.delete("/{character_id}")
async def delete_character(
    character_id: str,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if not await characters_d1.delete(_require(d1), user.id, character_id):
        raise HTTPException(status_code=404, detail="character not found")
    return {"ok": True}


@characters_router.post("/{character_id}/save")
async def save_character(
    character_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    body = await _json(request)
    try:
        await characters_d1.set_saved(
            _require(d1), user.id, character_id, bool(body.get("saved", True))
        )
    except characters_d1.CharacterError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@characters_router.post("/{character_id}/like")
async def like_character(
    character_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    body = await _json(request)
    try:
        await characters_d1.set_liked(
            _require(d1), user.id, character_id, bool(body.get("liked", True))
        )
    except characters_d1.CharacterError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@characters_router.post("/{character_id}/settings")
async def character_settings(
    character_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    """The per-character switches: texts you first, does things for you."""
    try:
        character = await characters_d1.set_settings(
            _require(d1), user.id, character_id, await _json(request)
        )
    except characters_d1.CharacterError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"character": character}


@characters_router.post("/{character_id}/activate")
async def activate_character(
    character_id: str,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    backend = _require(d1)
    try:
        character = await characters_d1.activate(backend, user.id, character_id)
    except characters_d1.CharacterError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    texted = await say_first_line(backend, user.id, character)
    return {"active": character, "textedYou": texted}


@characters_router.post("/active/clear")
async def back_to_yomi(
    user: User = Depends(get_current_user), d1: D1Backend | None = Depends(get_d1_backend)
):
    backend = _require(d1)
    changed = await characters_d1.deactivate(backend, user.id)
    if changed:
        chat_id = await _telegram_chat(backend, user.id)
        if chat_id:
            from yomi.gateway.telegram import send_message

            await send_message(chat_id, "back to plain yomi 👋")
    return {"active": None}


@characters_router.post("/draft")
async def draft_character(
    request: Request,
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    """"write for me": draft personality, tagline, description and a first line."""
    backend = _require(d1)
    body = await _json(request)
    name = str(body.get("name") or "").strip()[:30]
    if not name:
        raise HTTPException(status_code=400, detail="give them a name first")
    metering = await billing_d1.load_metering_user(backend, user.id)
    charge = await billing_d1.charge_usage(
        backend, ChargeInput(user=metering, kind="chat", units=1)
    )
    if not charge.ok:
        raise HTTPException(status_code=402, detail=charge.message)
    from yomi.services.llm import chat_completion, first_message

    template = TEMPLATES.get(str(body.get("template") or ""), "")
    brief = (
        f"Name: {name}\nBased on: {str(body.get('basedOn') or 'original')[:120]}\n"
        f"Looks: {str(body.get('appearance') or '')[:500]}\n"
        f"Style: {template}\nNotes: {str(body.get('personality') or '')[:1500]}"
    )
    data = await chat_completion(
        "fast",
        [
            {"role": "system", "content": (
                "You write personas for a texting assistant. Given a character brief, reply "
                'with JSON only: {"personality": str (how they think, text and behave, <=900 '
                'chars), "tagline": str (<=60 chars, lowercase), "description": str (<=300 '
                'chars), "first_line": str (their opening text, <=160 chars)}. If the name is '
                "a real person, write a clearly fictional, respectful persona and never claim "
                "to be them. Keep it safe for all audiences."
            )},
            {"role": "user", "content": brief},
        ],
        user_id=user.id,
        d1=backend,
        endpoint="characters.draft",
        timeout=45.0,
    )
    content = first_message(data).get("content") or ""
    match = re.search(r"\{.*\}", content, re.S)
    try:
        draft = json.loads(match.group(0)) if match else {}
    except ValueError:
        draft = {}
    return {
        "personality": str(draft.get("personality") or "")[:4000],
        "tagline": str(draft.get("tagline") or "")[:60],
        "description": str(draft.get("description") or "")[:500],
        "firstLine": str(draft.get("first_line") or "")[:2000],
    }
