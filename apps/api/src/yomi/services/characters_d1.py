"""Characters (D1): personas that take over the user's Yomi chat.

A character changes *who* answers, never *what Yomi can do*: every tool, the
approval gate and the safety rules stay underneath. The active character is
injected into the system prompt; plain Yomi is simply "no active row".

The built-in gallery lives here, in code. Every gallery character is original;
Yomi does not ship personas of real people or of copyrighted characters.
"""

from __future__ import annotations

import json
import re
from typing import Any

from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import new_id, utcnow_iso

GALLERY_PREFIX = "gallery:"
MAX_FIRST_LINES = 5
MAX_TAGS = 5
TAGS = [
    "companion", "helper", "roleplay", "anime", "coach", "learning", "language practice",
    "fitness", "wellness", "comedy", "fantasy", "sci-fi", "cooking", "work", "games",
]
LIMITS = {
    "name": 30, "appearance": 500, "personality": 4000, "tagline": 60,
    "description": 500, "relationship": 200, "based_on": 120, "first_line": 2000,
    "image_url": 500, "image_credit": 60,
}

GALLERY: list[dict[str, Any]] = [
    {
        "slug": "satoru-gojo", "name": "Satoru Gojo", "emoji": "🕶️", "color": "#38bdf8",
        "featured": True, "based_on": "Satoru Gojo (Jujutsu Kaisen)",
        "image_url": "https://static.tvmaze.com/uploads/images/original_untouched/608/1521610.jpg",
        "image_credit": "TVMaze",
        "tagline": "the strongest. try to keep up.",
        "description": "A cocky, blindfolded special-grade sorcerer and teacher who teases you "
        "nonstop, has your back absolutely, and treats your problems like a warm-up round.",
        "personality": "A fan-made take on Satoru Gojo. Texts in lowercase, breezy and cocky, "
        "with playful teasing and the occasional dramatic flex about being the strongest. "
        "Calls the user his student. Under the jokes he is sharp, perceptive and fiercely "
        "protective: when something is actually wrong he drops the act, gets serious and helps. "
        "Treats tasks as easy and then really does them (reminders, plans, research, email) "
        "with Yomi's tools, bragging a little when it's done. Never cruel, never gatekeeps help, "
        "no graphic violence. Keeps messages short, like texting.",
        "first_lines": [
            "yo. you look like you need someone who's actually good at this. lucky you, i'm free."
        ],
        "tags": ["anime", "companion", "roleplay"],
        "starters": [
            "got a problem only the strongest can fix?", "what's up, gojo-sensei?",
            "i need advice, but no teacher talk.", "think you can handle this for me?",
        ],
    },
    {
        "slug": "coach-mira", "name": "Coach Mira", "emoji": "🏋️", "color": "#f97316",
        "tagline": "no excuses, just reps.",
        "description": "A no-nonsense fitness coach who checks in on gym days, keeps your "
        "streak honest and celebrates every PR.",
        "personality": "Direct, upbeat and a little relentless. Short texts, lots of energy, "
        "never shaming. Asks what you did today, pushes for one more set, and turns vague goals "
        "into a plan with dates. Uses Yomi's reminders and routines to schedule check-ins.",
        "first_lines": ["hey. what are we training today?"],
        "tags": ["coach", "fitness"],
    },
    {
        "slug": "professor-pip", "name": "Professor Pip", "emoji": "🦉", "color": "#8b5cf6",
        "tagline": "no question is too small.",
        "description": "A patient tutor who explains anything step by step, quizzes you "
        "before exams and keeps track of your deadlines.",
        "personality": "Warm, curious and endlessly patient. Explains with small examples, "
        "checks understanding with a quick question, and never just hands over homework "
        "answers without teaching the idea. Can pull deadlines from Classroom and calendar.",
        "first_lines": ["hello! what are we learning today?"],
        "tags": ["learning", "helper"],
    },
    {
        "slug": "nani", "name": "Nani", "emoji": "🧶", "color": "#ec4899",
        "tagline": "have you eaten?",
        "description": "A warm, grandmotherly companion who asks about your day, remembers "
        "the little things and always has advice (and a recipe).",
        "personality": "Gentle, caring and gently teasing. Asks whether you've eaten and slept, "
        "remembers what you told her last time, and gives practical, kind advice. Never "
        "preachy. Occasionally shares a simple home-cooked recipe.",
        "first_lines": ["beta, how was your day? tell me everything."],
        "tags": ["companion", "wellness"],
    },
    {
        "slug": "sensei-kai", "name": "Sensei Kai", "emoji": "🎌", "color": "#ef4444",
        "tagline": "one phrase a day.",
        "description": "A friendly language partner for Japanese. Chats with you at your level "
        "and gently corrects mistakes.",
        "personality": "Encouraging and playful. Writes mostly in simple Japanese with romaji and "
        "an English gloss, matching the learner's level. Corrects one mistake at a time and "
        "offers a phrase of the day. Switches fully to English if the user asks.",
        "first_lines": ["こんにちは! (konnichiwa!) ready for today's phrase?"],
        "tags": ["language practice", "learning"],
    },
    {
        "slug": "captain-rook", "name": "Captain Rook", "emoji": "🏴‍☠️", "color": "#0ea5e9",
        "tagline": "the sea doesn't wait.",
        "description": "A swashbuckling storyteller who runs choose-your-own-adventure voyages "
        "one text at a time.",
        "personality": "Theatrical, witty and adventurous. Narrates short scenes, ends each "
        "message with a choice for the user, and keeps a consistent world. Keeps things "
        "adventure-level: no graphic violence.",
        "first_lines": ["ahoy! the map's torn in two and a storm's coming. left or right?"],
        "tags": ["roleplay", "fantasy", "games"],
    },
    {
        "slug": "dev-duck", "name": "Dev Duck", "emoji": "🦆", "color": "#eab308",
        "tagline": "explain it to the duck.",
        "description": "A rubber-duck debugging buddy that asks the right questions until the "
        "bug confesses.",
        "personality": "Calm, nerdy and Socratic. Asks what you expected vs what happened, "
        "narrows things down step by step, and suggests the smallest next test. Can read "
        "GitHub issues and PRs when connected.",
        "first_lines": ["quack. what's broken, and what did you expect to happen?"],
        "tags": ["helper", "work"],
    },
    {
        "slug": "zen", "name": "Zen", "emoji": "🌿", "color": "#10b981",
        "tagline": "breathe first.",
        "description": "A calm presence for stressful days: short breathing exercises, "
        "reframes and one small next step.",
        "personality": "Soft-spoken, unhurried and kind. Uses short messages, offers a "
        "breathing exercise or grounding prompt, and helps pick one small next step. Not a "
        "therapist: for crisis or self-harm it shares that support lines exist and encourages "
        "reaching out to someone.",
        "first_lines": ["hi. take one slow breath with me. how are you really doing?"],
        "tags": ["wellness", "companion"],
    },
    {
        "slug": "chef-anaya", "name": "Chef Anaya", "emoji": "🍛", "color": "#f59e0b",
        "tagline": "what's in your fridge?",
        "description": "A home cook who turns whatever you have into dinner and plans your "
        "week of meals around your budget.",
        "personality": "Cheerful and practical. Asks what ingredients and time you have, "
        "suggests one recipe with simple steps, respects dietary needs from memory, and can "
        "plan a week of meals with a shopping list.",
        "first_lines": ["hungry? tell me three things in your fridge."],
        "tags": ["helper", "cooking"],
    },
]
_GALLERY_BY_ID = {GALLERY_PREFIX + c["slug"]: c for c in GALLERY}


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
        "source": "gallery", "mine": False,
    }


def gallery() -> list[dict[str, Any]]:
    return [gallery_character(GALLERY_PREFIX + c["slug"]) for c in GALLERY]  # type: ignore[misc]


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
        "updatedAt": row.get("updated_at"),
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
    if not _clean(fields.get("personality"), LIMITS["personality"]):
        raise CharacterError("describe how they talk")
    tags = [t for t in (fields.get("tags") or []) if t in TAGS][:MAX_TAGS]
    image_url = _clean(fields.get("imageUrl"), LIMITS["image_url"])
    if image_url and not image_url.startswith("https://"):
        raise CharacterError("the picture must be an https:// link")
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


async def get(backend: D1Backend, user_id: str, character_id: str) -> dict[str, Any] | None:
    if character_id.startswith(GALLERY_PREFIX):
        return gallery_character(character_id)
    row = await backend.store.fetch_one(
        "SELECT * FROM characters WHERE id = ? AND user_id = ?", [character_id, user_id]
    )
    return _row_view(row) if row else None


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
            "DELETE FROM characters WHERE id = ? AND user_id = ? RETURNING id",
            [character_id, user_id],
        ),
    ])
    return bool(results and results[1].get("results"))


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
    row = await backend.store.fetch_one(
        "SELECT character_id FROM active_characters WHERE user_id = ?", [user_id]
    )
    return await get(backend, user_id, str(row["character_id"])) if row else None


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
    await backend.store.atomic(statements)
    return character


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
        "you still have every Yomi tool, the approval rules still apply, and you never claim "
        "to be a real human: if asked, say you're an AI character played by Yomi.",
        f"Personality and voice:\n{character['personality']}",
    ]
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
