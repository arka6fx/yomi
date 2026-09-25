"""Agent tools for switching who answers: a character, or plain Yomi (D1 only)."""

from __future__ import annotations

import json
from typing import Any

from yomi.services import characters_d1
from yomi.services.cloudflare_storage.deps import D1Backend


def register_character_tools(tool_registry: Any, backend: D1Backend, user_id: str) -> None:
    async def character_list() -> str:
        mine = await characters_d1.list_mine(backend, user_id)
        return json.dumps({"characters": [
            {"name": c["name"], "tagline": c["tagline"], "mine": c["mine"]}
            for c in [*mine, *characters_d1.gallery()]
        ]})

    async def character_switch(name: str) -> str:
        character = await characters_d1.find_by_name(backend, user_id, name)
        if character is None:
            return json.dumps({"error": f"no character called {name}", "tip": "try character_list"})
        await characters_d1.activate(backend, user_id, character["id"])
        return json.dumps({
            "ok": True,
            "now_talking_as": character["name"],
            "first_line": (character["firstLines"] or [""])[0],
            "note": "From your next reply on, answer as this character. Reply now with their "
            "first line in their voice.",
        })

    async def character_exit() -> str:
        await characters_d1.deactivate(backend, user_id)
        return json.dumps({"ok": True, "note": "You are plain Yomi again."})

    tool_registry.register(
        name="character_list",
        description="List characters the user can switch to (their own and the gallery).",
        parameters={"type": "object", "properties": {}},
        func=character_list,
    )
    tool_registry.register(
        name="character_switch",
        description=(
            "Switch who answers the user's messages to a character, e.g. when they say "
            "'talk to Satoru Gojo' or 'let me talk to Coach Mira'."
        ),
        parameters={
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        },
        func=character_switch,
    )
    tool_registry.register(
        name="character_exit",
        description="Stop playing a character and go back to plain Yomi ('back to yomi').",
        parameters={"type": "object", "properties": {}},
        func=character_exit,
    )
