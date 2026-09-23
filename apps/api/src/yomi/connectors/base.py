"""Connector runtime primitives: context, write-gating, error hints.

Ported from the retired TS `packages/agent-core/src/connectors/connector-def.ts`.
Tool shapes are OpenAI function-schema dicts; each connector's `tools(ctx)`
factory returns `{name: ConnectorTool}`.
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from yomi.conf import settings

# Risk levels stored on pending-action rows for the approval surface.
WRITE = "write"
SEND = "send"
PAID = "paid"
IRREVERSIBLE = "irreversible"


class ConnectorError(Exception):
    """Raised by connector internals; mapped to a structured tool result."""

    def __init__(self, message: str, hint: str | None = None):
        super().__init__(message)
        self.hint = hint


@dataclass(frozen=True)
class ConnectorTool:
    name: str
    description: str
    parameters: dict[str, Any]
    execute: Callable[[dict], Awaitable[Any]]

    def to_openai_spec(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


@dataclass
class ConnectorContext:
    """Per-user context handed to every tool factory.

    `get_access_token(user_id, provider)` returns a live (auto-refreshed) token.
    `create_pending_action`, when present, makes `gate_write` queue the write for
    explicit user approval instead of running it immediately.
    """

    user_id: str
    get_access_token: Callable[[str, str], Awaitable[str]]
    create_pending_action: Callable[[dict], Awaitable[dict]] | None = None


@dataclass
class ConnectorDef:
    id: str  # matches the provider key stored in mcp_connections
    name: str
    category: str
    icon: str
    description: str
    tools: Callable[[ConnectorContext], dict[str, ConnectorTool]]


def connector_error(err: BaseException) -> dict[str, str]:
    """Map a failed tool call to `{error}` plus a reconnect/action hint when known."""
    msg = str(err)
    hint = _error_hint(msg)
    return {"error": msg, **({"hint": hint} if hint else {})}


def _error_hint(msg: str) -> str | None:
    if re.search(r"restricted_resource|object_not_found", msg, re.IGNORECASE):
        return (
            "Notion returned a permission error. Make sure you've shared the relevant pages or "
            "databases with the Yomi integration (••• → Add connections) inside Notion."
        )
    if re.search(r'"error_subcode"\s*:\s*2534022|IGApiException', msg, re.IGNORECASE):
        return (
            "Instagram only allows a business account to message someone within 24 hours of that "
            "person's last DM to you (Meta's messaging window policy). Ask them to message you first."
        )
    if re.search(r"outside of allowed window", msg, re.IGNORECASE):
        return (
            "Meta only allows messaging someone within 24 hours of that person's last message to "
            "you (the standard messaging window policy). Ask them to message you first."
        )
    if re.search(
        r're-?engagement message|"error_subcode"\s*:\s*131047|"code"\s*:\s*131047',
        msg,
        re.IGNORECASE,
    ):
        return (
            "WhatsApp only allows free-form messages within 24 hours of the customer's last "
            "message to you. Outside that window you need a pre-approved message template."
        )
    if re.search(
        r"(?:→|status)\s*(401|403)\b|unauthorized|forbidden|invalid.*token|token.*invalid|revoked",
        msg,
        re.IGNORECASE,
    ):
        return f"Token expired or revoked — reconnect at {settings.app_url}/dashboard"
    return None


async def gate_write(
    ctx: ConnectorContext,
    meta: dict[str, Any],
    args: dict[str, Any],
    run: Callable[[], Awaitable[Any]],
) -> Any:
    """Queue a write for approval when the host supports it; otherwise run it.

    The stored payload is `args`. A pending-action executor replays an approved
    action by calling the same tool in a context WITHOUT `create_pending_action`,
    at which point `run` executes the real call.
    """
    if ctx.create_pending_action is not None:
        return await ctx.create_pending_action({**meta, "payload": args})
    return await run()