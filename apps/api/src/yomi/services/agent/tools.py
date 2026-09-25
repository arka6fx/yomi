import inspect
from collections.abc import Callable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from yomi.connectors.registry import default_registry
from yomi.services.browser import extract, scrape, screenshot


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, dict] = {}
        self._callables: dict[str, Callable] = {}

    def register(self, name: str, description: str, parameters: dict, func: Callable) -> None:
        self._tools[name] = {
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": parameters,
            }
        }
        self._callables[name] = func

    def get_openai_tools(self) -> list[dict]:
        return list(self._tools.values())

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


def register_computer_tools(tool_registry: ToolRegistry, user_id: str) -> None:
    """Personal-computer tools for the user's isolated desktop.

    Registered only when the computer gateway is configured. Screenshot
    results carry raw PNG bytes so the agent loop can forward them to the
    vision model as image parts.
    """
    import httpx

    from yomi.services.computer.client import ComputerClient

    def _client() -> tuple[ComputerClient, httpx.AsyncClient]:
        http = httpx.AsyncClient()
        return ComputerClient.for_user(http, user_id), http

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

    async def computer_open(url: str) -> str:
        import json as _json

        client, http = _client()
        try:
            result = await client.open_url(url)
        finally:
            await http.aclose()
        return _json.dumps(result)

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
    tool_registry.register(
        name="computer_open",
        description="Open an http(s) URL in a new tab on the user's desktop browser.",
        parameters={
            "type": "object",
            "properties": {"url": {"type": "string"}},
            "required": ["url"],
        },
        func=computer_open,
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

        tool_registry.register(name, tool.description, tool.parameters, _run_composio)
    tool_registry.composio_calls = composio_counter
    if computer_configured():
        register_computer_tools(tool_registry, user_id)
    if d1 is not None:
        from yomi.services.agent.vault_tools import register_vault_tools

        register_vault_tools(
            tool_registry, d1, user_id, create_pending_action, computer_configured()
        )
        from yomi.services.agent.trust_tools import register_trust_tools

        register_trust_tools(tool_registry, d1, user_id, create_pending_action)
        from yomi.services.agent.email_tools import register_email_tools

        register_email_tools(tool_registry, d1, user_id)
    return tool_registry
