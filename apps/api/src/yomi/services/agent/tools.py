import inspect
import re
from collections.abc import Callable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from yomi.connectors.registry import default_registry
from yomi.services.browser import extract, scrape, screenshot


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, dict] = {}
        self._callables: dict[str, Callable] = {}
        # Callable by name (approval replays, apps_run) but not sent to the model.
        self._hidden: set[str] = set()

    def register(
        self, name: str, description: str, parameters: dict, func: Callable,
        hidden: bool = False,
    ) -> None:
        self._tools[name] = {
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": parameters,
            }
        }
        self._callables[name] = func
        if hidden:
            self._hidden.add(name)

    def get_openai_tools(self) -> list[dict]:
        return [tool for name, tool in self._tools.items() if name not in self._hidden]

    def hidden_tools(self) -> list[dict]:
        return [self._tools[name] for name in self._hidden if name in self._tools]

    async def execute(self, name: str, **kwargs) -> Any:
        func = self._callables.get(name)
        if not func:
            raise ValueError(f"Tool {name} not found")
        if inspect.iscoroutinefunction(func):
            return await func(**kwargs)
        return func(**kwargs)

registry = ToolRegistry()

registry.register(
    name="browser_scrape",
    description="Scrape a webpage and return markdown.",
    parameters={
        "type": "object",
        "properties": {"url": {"type": "string"}},
        "required": ["url"],
    },
    func=scrape,
)

registry.register(
    name="browser_screenshot",
    description="Take a screenshot of a webpage.",
    parameters={
        "type": "object",
        "properties": {"url": {"type": "string"}},
        "required": ["url"],
    },
    func=screenshot,
)

registry.register(
    name="browser_extract",
    description="Extract specific information from a webpage.",
    parameters={
        "type": "object",
        "properties": {
            "url": {"type": "string"},
            "prompt": {"type": "string"}
        },
        "required": ["url", "prompt"],
    },
    func=extract,
)

async def _web_search(query: str) -> str:
    from yomi.services.browser import search_results

    return await search_results(query)

registry.register(
    name="web_search",
    description="Search the web for information.",
    parameters={
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
    },
    func=_web_search,
)


def computer_configured() -> bool:
    from yomi.conf import settings

    return bool(settings.computer_gateway_url and settings.computer_gateway_secret)


def format_page(page: dict) -> str:
    """Compact text view of a browser snapshot: what's on the page and what can be used."""
    lines = [
        f"Page: {page.get('title') or '(untitled)'} | {page.get('url') or ''}"
        + (f" | {page['tabs']} tabs" if page.get("tabs", 1) > 1 else ""),
        "Elements (act with web_act ref=N):",
    ]
    for el in page.get("elements") or []:
        bits = [f"[{el.get('ref')}] {el.get('role')} \"{el.get('name') or ''}\""]
        if el.get("value"):
            bits.append(f"value={el['value']!r}")
        if el.get("checked") is not None:
            bits.append("checked" if el["checked"] else "unchecked")
        if el.get("disabled"):
            bits.append("disabled")
        if el.get("options"):
            bits.append("options=" + " / ".join(el["options"]))
        lines.append(" ".join(bits))
    lines.append("Page text:")
    lines.append(str(page.get("text") or "").strip())
    return "\n".join(lines)


# Buttons that spend money or commit the user to something. Clicking one always
# waits for the user's Approve on Telegram, whatever the model decides.
_COMMIT_BUTTON = re.compile(
    r"\b(place (your )?order|order now|buy now|pay\b|pay now|make payment|proceed to pay"
    r"|complete (purchase|payment|order|booking)|confirm (order|payment|purchase|booking|ride|and pay)"
    r"|book (now|ride|cab|auto|tickets?)|request (ride|cab|auto|uber|bike)|submit order"
    r"|swipe to pay|subscribe now|start (subscription|membership)|donate)",
    re.IGNORECASE,
)


def is_commit_button(name: str) -> bool:
    return bool(name) and bool(_COMMIT_BUTTON.search(name))


def register_computer_tools(
    tool_registry: ToolRegistry, user_id: str, create_pending_action: Any = None
) -> None:
    """Personal-computer tools for the user's isolated desktop.

    Registered only when the computer gateway is configured. Screenshot
    results carry raw PNG bytes so the agent loop can forward them to the
    vision model as image parts.
    """
    from yomi.services.computer.client import ComputerClient

    class _Shared:
        """The process-wide client stays open; closing it per action is a no-op."""

        async def aclose(self) -> None:
            return None

    def _client() -> tuple[ComputerClient, _Shared]:
        from yomi.services.http_pool import shared_client

        # One warm connection to the gateway instead of a TLS handshake per click.
        return ComputerClient.for_user(shared_client(), user_id), _Shared()

    async def computer_screenshot() -> dict:
        client, http = _client()
        try:
            shot = await client.screenshot()
        finally:
            await http.aclose()
        return {
            "text": "Screenshot of the user's desktop (1280x800). Ground element coordinates in pixels.",
            "images": [shot],
        }

    async def computer_input(**kwargs) -> str:
        import json as _json

        client, http = _client()
        try:
            result = await client.input(dict(kwargs))
        finally:
            await http.aclose()
        return _json.dumps(result)

    # The last page the agent read: element number -> label, and its URL. Used to
    # recognise a purchase button behind a bare element number.
    last_page: dict[str, Any] = {"url": "", "names": {}}

    def _seen(page: dict) -> str:
        last_page["url"] = page.get("url") or ""
        last_page["names"] = {
            str(el.get("ref")): str(el.get("name") or "") for el in page.get("elements") or []
        }
        return format_page(page)

    async def web_open(url: str) -> str:
        client, _ = _client()
        return _seen(await client.browser_navigate(url))

    async def web_page() -> str:
        client, _ = _client()
        return _seen(await client.browser_snapshot())

    async def web_act(**kwargs) -> Any:
        client, _ = _client()
        expect_name = kwargs.pop("expect_name", None)
        expect_url = kwargs.pop("expect_url", None)
        action = {k: v for k, v in kwargs.items() if v is not None}
        kind = action.get("action")
        ref = str(action.get("ref") or "")

        if expect_name:
            # Replaying an approved click: numbers may have changed since, so find the
            # same button again by its label, and refuse if the page moved on.
            page = await client.browser_snapshot()
            if expect_url and page.get("url") != expect_url:
                return (
                    "The page changed since you approved (it's now "
                    f"{page.get('url')}). Nothing was clicked; ask Yomi to try again."
                )
            match = next(
                (el for el in page.get("elements") or [] if el.get("name") == expect_name), None
            )
            if match is None:
                return f"Couldn't find “{expect_name}” on the page any more; nothing was clicked."
            action["ref"] = str(match.get("ref"))
            return _seen(await client.browser_act(action))

        name = last_page["names"].get(ref, "")
        if kind in ("click", "check") and is_commit_button(name) and create_pending_action:
            from urllib.parse import urlsplit

            host = urlsplit(last_page["url"]).hostname or "the site"
            return await create_pending_action({
                "connector": "computer",
                "action": "web_act",
                "risk": "payment",
                "title": f"Click “{name}” on {host}",
                "preview": f"Yomi wants to press “{name}” on {last_page['url'][:300]}",
                "confirm_text": "Yes, press it",
                "payload": {**action, "expect_name": name, "expect_url": last_page["url"]},
            })
        return _seen(await client.browser_act(action))

    async def computer_windows() -> str:
        import json as _json

        client, http = _client()
        try:
            result = await client.windows()
        finally:
            await http.aclose()
        return _json.dumps(result)

    async def computer_exec(argv: list[str]) -> str:
        """Run an argv-only command in this user's isolated desktop."""
        import json as _json

        if not isinstance(argv, list) or not argv or not all(isinstance(item, str) for item in argv):
            raise ValueError("argv must be a non-empty list of strings")
        client, http = _client()
        try:
            result = await client.execute(argv[:32])
        finally:
            await http.aclose()
        return _json.dumps(result)

    tool_registry.register(
        name="computer_screenshot",
        description="Take a screenshot of the user's personal desktop. Returns an image you can see.",
        parameters={"type": "object", "properties": {}},
        func=computer_screenshot,
    )
    tool_registry.register(
        name="computer_input",
        description=(
            "Control the user's desktop: click/double_click (x, y, button), "
            "move (x, y), drag (x, y, path), scroll (x, y, dx, dy), "
            "type (text), key (keys list), wait (seconds). Coordinates are pixels in 1280x800."
        ),
        parameters={
            "type": "object",
            "properties": {
                "action": {"type": "string"},
                "x": {"type": "number"},
                "y": {"type": "number"},
                "button": {"type": "string"},
                "path": {"type": "array"},
                "dx": {"type": "number"},
                "dy": {"type": "number"},
                "text": {"type": "string"},
                "keys": {"type": "array"},
                "seconds": {"type": "number"},
            },
            "required": ["action"],
        },
        func=computer_input,
    )
    async def computer_handoff(reason: str) -> str:
        from yomi.app.routes.computer import computer_page_url

        return (
            f"Ask the user to open {computer_page_url()} to take over the computer "
            f"({reason}). They can type there; their logins are kept for next time. "
            "Wait for them to say they're done, then continue with web_page."
        )

    tool_registry.register(
        name="computer_handoff",
        description=(
            "When a site needs something only the user should do (sign in, an OTP, a captcha, "
            "confirming a payment page), get the link where they can see and control the "
            "computer. Share the link with the user in your reply."
        ),
        parameters={
            "type": "object",
            "properties": {"reason": {"type": "string", "description": "e.g. 'sign in to Zomato'"}},
            "required": ["reason"],
        },
        func=computer_handoff,
    )
    tool_registry.register(
        name="web_open",
        description=(
            "Open a website in the browser on the user's private computer (shopping, food, "
            "rides, bookings, any site). Returns the page as text plus numbered elements "
            "you can act on with web_act."
        ),
        parameters={
            "type": "object",
            "properties": {"url": {"type": "string"}},
            "required": ["url"],
        },
        func=web_open,
    )
    tool_registry.register(
        name="web_page",
        description="Read the current page in the computer's browser (text + numbered elements).",
        parameters={"type": "object", "properties": {}},
        func=web_page,
    )
    tool_registry.register(
        name="web_act",
        description=(
            "Act on the current page by element number from web_open/web_page/web_act: "
            "click (ref), type (ref, text, submit), select (ref, value), check (ref, checked), "
            "press (key), scroll (direction up|down), back, wait (seconds). Returns the page "
            "after the action. Never place an order or pay without the user's approval."
        ),
        parameters={
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["click", "type", "select", "check", "press", "scroll", "back",
                             "wait"],
                },
                "ref": {"type": "string", "description": "Element number, e.g. '12'"},
                "text": {"type": "string"},
                "submit": {"type": "boolean", "description": "Press Enter after typing"},
                "value": {"type": "string", "description": "Option label for select"},
                "checked": {"type": "boolean"},
                "key": {"type": "string", "description": "e.g. Enter, Escape, Tab"},
                "direction": {"type": "string", "enum": ["up", "down"]},
                "seconds": {"type": "number"},
            },
            "required": ["action"],
        },
        func=web_act,
    )
    tool_registry.register(
        name="computer_windows",
        description="List open window titles on the user's desktop.",
        parameters={"type": "object", "properties": {}},
        func=computer_windows,
    )
    tool_registry.register(
        name="computer_exec",
        description=(
            "Run a command in the user's private isolated desktop terminal. "
            "Pass argv as an array (for example [\"pwd\"] or [\"python\", \"-c\", \"...\"]). "
            "Use this for files and CLI work; never use shell metacharacters to hide actions."
        ),
        parameters={
            "type": "object",
            "properties": {
                "argv": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 32},
            },
            "required": ["argv"],
        },
        func=computer_exec,
    )


async def build_user_registry(
    db: AsyncSession,
    user_id: str,
    create_pending_action: Callable[[dict], Any] | None = None,
    d1: Any = None,
) -> ToolRegistry:
    """Global browser/search tools plus the connector tool set for `user_id`.

    Connector tools resolve live tokens through `db` and queue writes through
    `create_pending_action` when provided. In D1 mode (`d1` given) tokens and
    the Composio mirror resolve through the storage gateway instead.
    """
    from yomi.connectors.base import ConnectorContext

    tool_registry = ToolRegistry()
    tool_registry._tools = dict(registry._tools)
    tool_registry._callables = dict(registry._callables)
    tool_registry._hidden = set(registry._hidden)

    if d1 is not None:
        from yomi.services import connectors_d1 as _connectors_d1

        connected = await _connectors_d1.connected_providers(d1, user_id)
        ctx = ConnectorContext(
            user_id=user_id,
            get_access_token=_connectors_d1.token_provider(d1),
            create_pending_action=create_pending_action,
        )
        connector_tools = {}
        for connector_id in connected:
            definition = default_registry.def_for(connector_id)
            if definition is None:
                continue
            connector_tools.update(definition.tools(ctx))
    else:
        connector_tools = await default_registry.tools_for_user(
            db, user_id, create_pending_action=create_pending_action
        )
    for name, tool in connector_tools.items():

        async def _run(_tool=tool, **_kwargs):
            return await _tool.execute(_kwargs)

        tool_registry.register(name, tool.description, tool.parameters, _run)

    if d1 is not None:
        from yomi.services import connectors_d1 as _connectors_d1

        composio_tools, composio_counter = await _connectors_d1.build_composio_tools_d1(
            d1, user_id, create_pending_action
        )
    else:
        from yomi.connectors.composio import build_composio_tools

        composio_tools, composio_counter = await build_composio_tools(
            user_id, create_pending_action, db
        )
    for name, tool in composio_tools.items():

        async def _run_composio(_tool=tool, **_kwargs):
            return await _tool.execute(_kwargs)

        # App actions number in the dozens per app (Notion alone was ~60k tokens of
        # schema). Keep them out of every prompt; the model finds and runs them
        # through apps_find / apps_run only when a task needs one.
        tool_registry.register(
            name, tool.description, tool.parameters, _run_composio, hidden=True
        )
    if composio_tools:
        from yomi.services.agent.app_tools import register_app_tools

        register_app_tools(tool_registry)
    tool_registry.composio_calls = composio_counter
    if computer_configured():
        register_computer_tools(tool_registry, user_id, create_pending_action)
    if d1 is not None:
        from yomi.services.agent.vault_tools import register_vault_tools

        register_vault_tools(
            tool_registry, d1, user_id, create_pending_action, computer_configured()
        )
        from yomi.services.agent.trust_tools import register_trust_tools

        register_trust_tools(tool_registry, d1, user_id, create_pending_action)
        from yomi.services.agent.email_tools import register_email_tools

        register_email_tools(tool_registry, d1, user_id)
        from yomi.services.agent.schedule_tools import register_schedule_tools

        register_schedule_tools(tool_registry, d1, user_id)
        from yomi.services.agent.character_tools import register_character_tools

        register_character_tools(tool_registry, d1, user_id)
    return tool_registry
