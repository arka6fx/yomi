"""Subrouters mounted under the API."""

from .actions import actions_router
from .conversation import conversation_router
from .custom_mcp import custom_mcp_router
from .health import health_router
from .history import history_router
from .integrations import integrations_router
from .suggestions import suggestions_router
from .usage import usage_router

__all__ = [
    "health_router",
    "usage_router",
    "integrations_router",
    "suggestions_router",
    "actions_router",
    "conversation_router",
    "history_router",
    "custom_mcp_router",
]