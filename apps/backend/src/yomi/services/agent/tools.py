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
    import openai

    from yomi.conf import settings
    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    # Using the search model, but maybe it requires a special endpoint or system prompt
    res = await client.chat.completions.create(
        model=settings.openai_web_search_model,
        messages=[{"role": "user", "content": query}]
    )
    return res.choices[0].message.content or ""

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


async def build_user_registry(
    db: AsyncSession,
    user_id: str,
    create_pending_action: Callable[[dict], Any] | None = None,
) -> ToolRegistry:
    """Global browser/search tools plus the connector tool set for `user_id`.

    Connector tools resolve live tokens through `db` and queue writes through
    `create_pending_action` when provided.
    """
    tool_registry = ToolRegistry()
    tool_registry._tools = dict(registry._tools)
    tool_registry._callables = dict(registry._callables)
    connector_tools = await default_registry.tools_for_user(
        db, user_id, create_pending_action=create_pending_action
    )
    for name, tool in connector_tools.items():

        async def _run(_tool=tool, **_kwargs):
            return await _tool.execute(_kwargs)

        tool_registry.register(name, tool.description, tool.parameters, _run)

    from yomi.connectors.composio import build_composio_tools

    composio_tools, composio_counter = await build_composio_tools(
        user_id, create_pending_action, db
    )
    for name, tool in composio_tools.items():

        async def _run_composio(_tool=tool, **_kwargs):
            return await _tool.execute(_kwargs)

        tool_registry.register(name, tool.description, tool.parameters, _run_composio)
    tool_registry.composio_calls = composio_counter
    return tool_registry
