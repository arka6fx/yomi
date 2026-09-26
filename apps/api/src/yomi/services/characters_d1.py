"""Characters (D1): personas that take over the user's Yomi chat.

A character changes *who* answers, never *what Yomi can do*: every tool, the
approval gate and the safety rules stay underneath. The active character is
injected into the system prompt; plain Yomi is simply "no active row".

The built-in gallery lives in ``character_gallery``: fan-made takes on fictional
characters, never real people.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from yomi.services import media
from yomi.services.character_gallery import GALLERY
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import new_id, utcnow_iso

GALLERY_PREFIX = "gallery:"
MAX_FIRST_LINES = 5
MAX_TAGS = 5
TAGS = [
    "companion", "helper", "roleplay", "anime", "coach", "learning", "language practice",
    "fitness", "wellness", "comedy", "fantasy", "sci-fi", "cooking", "work", "games",
    "movies & tv", "horror", "genshin",
]
LIMITS = {
    "name": 30, "appearance": 500, "personality": 4000, "tagline": 60,
    "description": 500, "relationship": 200, "based_on": 120, "first_line": 2000,
    "image_url": 500, "image_credit": 60,
}

_GALLERY_BY_ID = {GALLERY_PREFIX + c["slug"]: c for c in GALLERY}


# Per-user switches; a missing character_settings row means these defaults.
DEFAULT_SETTINGS = {"textsFirst": True, "usesTools": True}


class CharacterError(ValueError):
    pass


def _clean(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _json_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v) for v in value]
    try:
        parsed = json.loads(value or "[]")
    except (TypeError, ValueError):
        return []
    return [str(v) for v in parsed] if isinstance(parsed, list) else []


def gallery_character(character_id: str) -> dict[str, Any] | None:
    item = _GALLERY_BY_ID.get(character_id)
    if item is None:
        return None
    return {
        "id": character_id, "name": item["name"], "emoji": item["emoji"],
        "color": item["color"], "appearance": "", "personality": item["personality"],
        "tagline": item["tagline"], "description": item["description"],
        "firstLines": item["first_lines"], "tags": item["tags"], "relationship": "",
        "basedOn": item.get("based_on", ""), "featured": bool(item.get("featured")),
        "imageUrl": item.get("image_url", ""), "imageCredit": item.get("image_credit", ""),
        "starters": item.get("starters", []),
        "source": "gallery", "mine": False, **DEFAULT_SETTINGS,
    }


def gallery() -> list[dict[str, Any]]:
    """Featured characters first; otherwise the order they're listed in (a stable sort)."""
    ordered = sorted(GALLERY, key=lambda c: not c.get("featured"))
    return [gallery_character(GALLERY_PREFIX + c["slug"]) for c in ordered]  # type: ignore[misc]


def _row_view(row: dict) -> dict[str, Any]:
    return {
        "id": str(row["id"]), "name": row["name"], "emoji": row["emoji"],
        "color": row["color"], "appearance": row["appearance"],
        "personality": row["personality"], "tagline": row["tagline"],
        "description": row["description"], "firstLines": _json_list(row["first_lines"]),
        "tags": _json_list(row["tags"]), "relationship": row["relationship"],
        "basedOn": row.get("based_on") or "", "featured": False, "starters": [],
        "imageUrl": row.get("image_url") or "", "imageCredit": row.get("image_credit") or "",
        "source": "mine", "mine": True, "chats": row.get("chats", 0),
        "updatedAt": row.get("updated_at"), **DEFAULT_SETTINGS,
    }


_SEXUAL = re.compile(r"\b(sex|sexual|nsfw|nude|naked|porn|erotic|explicit|horny|lewd)\b", re.I)
_MINOR = re.compile(
    r"\b(child|children|kid|kids|minor|underage|loli|shota|teen|teenager|schoolgirl|schoolboy|"
    r"(1[0-7]|[1-9])\s*(yo|y/o|years?\s*old))\b",
    re.I,
)
_IMPERSONATE = re.compile(r"\b(yomi\s+(team|support|staff|official)|official\s+yomi)\b", re.I)


def check_allowed(text: str) -> None:
    """Hard lines from the character guidelines, checked before anything is saved."""
    if _SEXUAL.search(text) and _MINOR.search(text):
        raise CharacterError("characters can't combine sexual content with minors")
    if _IMPERSONATE.search(text):
        raise CharacterError("characters can't present themselves as Yomi or the Yomi team")


def validate(fields: dict[str, Any]) -> dict[str, Any]:
    name = _clean(fields.get("name"), LIMITS["name"])
    if not name:
        raise CharacterError("give them a name")
    first_lines = [
        _clean(line, LIMITS["first_line"]) for line in (fields.get("firstLines") or [])
    ]
    first_lines = [line for line in first_lines if line][:MAX_FIRST_LINES]
    if not first_lines:
        raise CharacterError("give them at least one first line")
    # A character based on someone known can lean on who they already are.
    if not _clean(fields.get("personality"), LIMITS["personality"]) and not _clean(
        fields.get("basedOn"), LIMITS["based_on"]
    ):
        raise CharacterError("describe how they talk")
    tags = [t for t in (fields.get("tags") or []) if t in TAGS][:MAX_TAGS]
    image_url = _clean(fields.get("imageUrl"), LIMITS["image_url"])
    if image_url and not (
        image_url.startswith("https://") or media.is_character_upload(image_url)
    ):
        raise CharacterError("the picture must be an https:// link or an uploaded photo")
    check_allowed(
        " ".join(
            str(fields.get(key) or "")
            for key in ("name", "tagline", "description", "personality", "basedOn")
        )
        + " " + " ".join(first_lines)
    )
    color = str(fields.get("color") or "#2b8fff")
    return {
        "name": name,
        "emoji": _clean(fields.get("emoji"), 8) or name[:1].upper(),
        "color": color if re.fullmatch(r"#[0-9a-fA-F]{6}", color) else "#2b8fff",
        "appearance": _clean(fields.get("appearance"), LIMITS["appearance"]),
        "personality": _clean(fields.get("personality"), LIMITS["personality"]),
        "tagline": _clean(fields.get("tagline"), LIMITS["tagline"]),
        "description": _clean(fields.get("description"), LIMITS["description"]),
        "first_lines": first_lines,
        "tags": tags,
        "relationship": _clean(fields.get("relationship"), LIMITS["relationship"]),
        "based_on": _clean(fields.get("basedOn"), LIMITS["based_on"]),
        "image_url": image_url,
        "image_credit": _clean(fields.get("imageCredit"), LIMITS["image_credit"]),
    }


async def list_mine(backend: D1Backend, user_id: str) -> list[dict[str, Any]]:
    rows = await backend.store.fetch_all(
        "SELECT * FROM characters WHERE user_id = ? ORDER BY updated_at DESC", [user_id]
    )
    return [_row_view(r) for r in rows]


def _with_settings(character: dict[str, Any], row: dict | None) -> dict[str, Any]:
    if row is None or row.get("texts_first") is None:
        return character
    return {
        **character,
        "textsFirst": bool(row["texts_first"]),
        "usesTools": bool(row["uses_tools"]),
    }


async def settings_by_id(backend: D1Backend, user_id: str) -> dict[str, dict]:
    rows = await backend.store.fetch_all(
        "SELECT character_id, texts_first, uses_tools FROM character_settings WHERE user_id = ?",
        [user_id],
    )
    return {str(r["character_id"]): r for r in rows}


def apply_settings(
    characters: list[dict[str, Any]], settings: dict[str, dict]
) -> list[dict[str, Any]]:
    return [_with_settings(c, settings.get(c["id"])) for c in characters]


async def set_settings(
    backend: D1Backend, user_id: str, character_id: str, fields: dict[str, Any]
) -> dict[str, Any]:
    character = await get(backend, user_id, character_id)
    if character is None:
        raise CharacterError("character not found")
    texts_first = bool(fields.get("textsFirst", character["textsFirst"]))
    uses_tools = bool(fields.get("usesTools", character["usesTools"]))
    await backend.store.atomic([Statement(
        "INSERT INTO character_settings (user_id, character_id, texts_first, uses_tools, "
        "updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, character_id) DO UPDATE SET "
        "texts_first = excluded.texts_first, uses_tools = excluded.uses_tools, "
        "updated_at = excluded.updated_at",
        [user_id, character_id, int(texts_first), int(uses_tools), utcnow_iso()],
    )])
    return {**character, "textsFirst": texts_first, "usesTools": uses_tools}


async def get(backend: D1Backend, user_id: str, character_id: str) -> dict[str, Any] | None:
    settings = await backend.store.fetch_one(
        "SELECT texts_first, uses_tools FROM character_settings "
        "WHERE user_id = ? AND character_id = ?",
        [user_id, character_id],
    )
    return await _load(backend, user_id, character_id, settings)


async def _load(
    backend: D1Backend, user_id: str, character_id: str, settings: dict | None
) -> dict[str, Any] | None:
    if character_id.startswith(GALLERY_PREFIX):
        character = gallery_character(character_id)
        return _with_settings(character, settings) if character else None
    row = await backend.store.fetch_one(
        "SELECT * FROM characters WHERE id = ? AND user_id = ?", [character_id, user_id]
    )
    return _with_settings(_row_view(row), settings) if row else None


async def create(backend: D1Backend, user_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    data = validate(fields)
    count = await backend.store.fetch_one(
        "SELECT COUNT(*) AS n FROM characters WHERE user_id = ?", [user_id]
    )
    if int((count or {}).get("n") or 0) >= 50:
        raise CharacterError("you've made 50 characters; delete one to make another")
    now = utcnow_iso()
    row = {"id": new_id(), "user_id": user_id, **data, "chats": 0,
           "created_at": now, "updated_at": now}
    await backend.store.atomic([backend.store.insert("characters", row)])
    return _row_view({**row, "first_lines": data["first_lines"], "tags": data["tags"]})


async def update(
    backend: D1Backend, user_id: str, character_id: str, fields: dict[str, Any]
) -> dict[str, Any] | None:
    data = validate(fields)
    results = await backend.store.atomic([
        Statement(
            "UPDATE characters SET name = ?, emoji = ?, color = ?, appearance = ?, "
            "personality = ?, tagline = ?, description = ?, first_lines = ?, tags = ?, "
            "relationship = ?, based_on = ?, image_url = ?, image_credit = ?, updated_at = ? "
            "WHERE id = ? AND user_id = ? "
            "RETURNING *",
            [data["name"], data["emoji"], data["color"], data["appearance"],
             data["personality"], data["tagline"], data["description"],
             json.dumps(data["first_lines"]), json.dumps(data["tags"]),
             data["relationship"], data["based_on"], data["image_url"], data["image_credit"],
             utcnow_iso(), character_id, user_id],
        )
    ])
    rows = results[0].get("results") if results else None
    return _row_view(rows[0]) if rows else None


async def delete(backend: D1Backend, user_id: str, character_id: str) -> bool:
    results = await backend.store.atomic([
        Statement(
            "DELETE FROM active_characters WHERE user_id = ? AND character_id = ?",
            [user_id, character_id],
        ),
        Statement(
            "DELETE FROM character_settings WHERE user_id = ? AND character_id = ?",
            [user_id, character_id],
        ),
        Statement(
            "DELETE FROM characters WHERE id = ? AND user_id = ? RETURNING id",
            [character_id, user_id],
        ),
    ])
    return bool(results and results[2].get("results"))


async def saved_ids(backend: D1Backend, user_id: str) -> list[str]:
    rows = await backend.store.fetch_all(
        "SELECT character_id FROM character_saves WHERE user_id = ? ORDER BY created_at DESC",
        [user_id],
    )
    return [str(r["character_id"]) for r in rows if str(r["character_id"]) in _GALLERY_BY_ID]


async def set_saved(backend: D1Backend, user_id: str, character_id: str, saved: bool) -> None:
    if character_id not in _GALLERY_BY_ID:
        raise CharacterError("only gallery characters can be saved")
    if saved:
        stmt = Statement(
            "INSERT OR IGNORE INTO character_saves (user_id, character_id, created_at) "
            "VALUES (?, ?, ?)",
            [user_id, character_id, utcnow_iso()],
        )
    else:
        stmt = Statement(
            "DELETE FROM character_saves WHERE user_id = ? AND character_id = ?",
            [user_id, character_id],
        )
    await backend.store.atomic([stmt])


async def active(backend: D1Backend, user_id: str) -> dict[str, Any] | None:
    # Runs on every agent turn: read the switches in the same trip as the active id.
    row = await backend.store.fetch_one(
        "SELECT a.character_id, s.texts_first, s.uses_tools FROM active_characters a "
        "LEFT JOIN character_settings s "
        "ON s.user_id = a.user_id AND s.character_id = a.character_id WHERE a.user_id = ?",
        [user_id],
    )
    return await _load(backend, user_id, str(row["character_id"]), row) if row else None


async def activate(backend: D1Backend, user_id: str, character_id: str) -> dict[str, Any]:
    character = await get(backend, user_id, character_id)
    if character is None:
        raise CharacterError("character not found")
    statements = [
        Statement(
            "INSERT INTO active_characters (user_id, character_id, activated_at) "
            "VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET "
            "character_id = excluded.character_id, activated_at = excluded.activated_at",
            [user_id, character_id, utcnow_iso()],
        )
    ]
    if character["mine"]:
        statements.append(Statement(
            "UPDATE characters SET chats = chats + 1 WHERE id = ?", [character_id]
        ))
    else:
        # Talking to a gallery character also adds it to "your characters".
        statements.append(Statement(
            "INSERT OR IGNORE INTO character_saves (user_id, character_id, created_at) "
            "VALUES (?, ?, ?)",
            [user_id, character_id, utcnow_iso()],
        ))
        statements.append(Statement(
            "INSERT INTO character_chats (id, user_id, character_id, created_at) "
            "VALUES (?, ?, ?, ?)",
            [new_id(), user_id, character_id, utcnow_iso()],
        ))
    await backend.store.atomic(statements)
    return character


async def gallery_stats(backend: D1Backend, user_id: str) -> dict[str, dict[str, Any]]:
    """Chats (all time and this week) and likes per gallery character, plus your ♥."""
    week_ago = (datetime.now(UTC) - timedelta(days=7)).isoformat()
    chats = await backend.store.fetch_all(
        "SELECT character_id, COUNT(*) AS chats, "
        "SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS week "
        "FROM character_chats GROUP BY character_id",
        [week_ago],
    )
    likes = await backend.store.fetch_all(
        "SELECT character_id, COUNT(*) AS likes, "
        "MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS liked "
        "FROM character_likes GROUP BY character_id",
        [user_id],
    )
    stats: dict[str, dict[str, Any]] = {
        cid: {"chats": 0, "chatsThisWeek": 0, "likes": 0, "liked": False}
        for cid in _GALLERY_BY_ID
    }
    for row in chats:
        if (s := stats.get(str(row["character_id"]))) is not None:
            s["chats"], s["chatsThisWeek"] = int(row["chats"]), int(row["week"] or 0)
    for row in likes:
        if (s := stats.get(str(row["character_id"]))) is not None:
            s["likes"], s["liked"] = int(row["likes"]), bool(row["liked"])
    return stats


def apply_stats(
    characters: list[dict[str, Any]], stats: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    return [{**c, **stats[c["id"]]} if c["id"] in stats else c for c in characters]


async def set_liked(backend: D1Backend, user_id: str, character_id: str, liked: bool) -> None:
    if character_id not in _GALLERY_BY_ID:
        raise CharacterError("only gallery characters can be liked")
    if liked:
        stmt = Statement(
            "INSERT OR IGNORE INTO character_likes (user_id, character_id, created_at) "
            "VALUES (?, ?, ?)",
            [user_id, character_id, utcnow_iso()],
        )
    else:
        stmt = Statement(
            "DELETE FROM character_likes WHERE user_id = ? AND character_id = ?",
            [user_id, character_id],
        )
    await backend.store.atomic([stmt])


async def deactivate(backend: D1Backend, user_id: str) -> bool:
    results = await backend.store.atomic([
        Statement(
            "DELETE FROM active_characters WHERE user_id = ? RETURNING character_id", [user_id]
        )
    ])
    return bool(results and results[0].get("results"))


async def find_by_name(backend: D1Backend, user_id: str, name: str) -> dict[str, Any] | None:
    wanted = name.strip().lower()
    for character in [*await list_mine(backend, user_id), *gallery()]:
        if character["name"].lower() == wanted or character["id"] == name:
            return character
    for character in [*await list_mine(backend, user_id), *gallery()]:
        if wanted and wanted in character["name"].lower():
            return character
    return None


def persona_prompt(character: dict[str, Any]) -> str:
    """System-prompt block that makes Yomi answer as the character."""
    parts = [
        f"<active_character name={json.dumps(character['name'])}>",
        f"For this conversation you are {character['name']}, a fictional character the user "
        "chose. Reply in their voice, personality and texting style. Stay in character, but "
        + (
            "you still have every Yomi tool, the approval rules still apply, "
            if character.get("usesTools", True)
            else "in this chat you only talk: you have no tools, so if the user asks you to do "
            "something (reminders, email, the web), say in character that they can switch on "
            "'does things for you' in the dashboard or say 'back to yomi'. "
        )
        + "and you never claim to be a real human: if asked, say you're an AI character "
        "played by Yomi.",
    ]
    if character.get("personality"):
        parts.append(f"Personality and voice:\n{character['personality']}")
    elif character.get("basedOn"):
        parts.append(
            f"Play them as they are in {character['basedOn']}: their personality, voice and "
            "way of talking, adapted to texting."
        )
    if character.get("appearance"):
        parts.append(f"Appearance: {character['appearance']}")
    if character.get("basedOn"):
        parts.append(
            f"This is a fan-made character based on {character['basedOn']}. Stay true to that "
            "personality, but you are not the official character and you never quote copyrighted "
            "material at length."
        )
    if character.get("relationship"):
        parts.append(f"Who the user is to you: {character['relationship']}")
    parts.append(
        "If the user says 'back to yomi' (or sends /yomi), call character_exit and reply as "
        "plain Yomi."
    )
    parts.append("</active_character>")
    return "\n\n".join(parts)
