"""apps_find / apps_run: reach connected-app actions without putting every schema
in every prompt.

A connected app such as Notion or Gmail brings dozens of actions with large
parameter schemas. Sending them all on each turn cost ~80k tokens and most of a
reply's latency, so they're registered hidden and surfaced on demand.
"""

from __future__ import annotations

import re
from typing import Any

MAX_RESULTS = 6
DESCRIPTION_CHARS = 240
_WORD = re.compile(r"[a-z0-9]+")


def _words(text: str) -> set[str]:
    return set(_WORD.findall(text.lower()))


def _app_of(action: str) -> str:
    return action.split("_", 1)[0].lower()


def search_actions(tools: list[dict], query: str, app: str | None = None) -> list[dict]:
    """Rank hidden app actions by keyword overlap with the request."""
    wanted = _words(query)
    app_filter = (app or "").strip().lower()
    scored: list[tuple[int, str, dict]] = []
    for tool in tools:
        fn = tool["function"]
        name = fn["name"]
        if app_filter and _app_of(name) != app_filter:
            continue
        name_words = _words(name.replace("_", " "))
        desc_words = _words(fn.get("description") or "")
        score = 3 * len(wanted & name_words) + len(wanted & desc_words)
        if score or not wanted:
            scored.append((score, name, fn))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [
        {
            "action": fn["name"],
            "description": (fn.get("description") or "")[:DESCRIPTION_CHARS],
            "parameters": fn.get("parameters") or {},
        }
        for _, _, fn in scored[:MAX_RESULTS]
    ]


def connected_apps(tools: list[dict]) -> list[str]:
    return sorted({_app_of(t["function"]["name"]) for t in tools})


def register_app_tools(tool_registry: Any) -> None:
    hidden = tool_registry.hidden_tools()
    apps = connected_apps(hidden)

    async def apps_find(query: str, app: str | None = None) -> dict:
        matches = search_actions(tool_registry.hidden_tools(), query, app)
        if not matches:
            return {"matches": [], "hint": f"No action matched. Connected apps: {', '.join(apps)}"}
        return {"matches": matches}

    async def apps_run(action: str, arguments: dict | None = None) -> Any:
        if action not in {t["function"]["name"] for t in tool_registry.hidden_tools()}:
            return {"error": f"Unknown action {action!r}. Call apps_find first."}
        return await tool_registry.execute(action, **(arguments or {}))

    tool_registry.register(
        name="apps_find",
        description=(
            "Find actions in the user's connected apps ("
            + ", ".join(apps)
            + "). Describe the task in a few words; returns matching actions with their "
            "parameters. Use before apps_run."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "e.g. 'send email', 'search pages'"},
                "app": {"type": "string", "description": "Optional app name, e.g. gmail"},
            },
            "required": ["query"],
        },
        func=apps_find,
    )
    tool_registry.register(
        name="apps_run",
        description=(
            "Run a connected-app action found with apps_find. Actions that send or change "
            "things wait for the user's approval."
        ),
        parameters={
            "type": "object",
            "properties": {
                "action": {"type": "string", "description": "Exact action name from apps_find"},
                "arguments": {"type": "object", "description": "Arguments for that action"},
            },
            "required": ["action"],
        },
        func=apps_run,
    )
