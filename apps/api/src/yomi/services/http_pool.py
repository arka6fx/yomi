"""One long-lived HTTP client per process.

Opening a client per request meant a fresh TLS handshake to the storage gateway
and to Workers AI on every call. A shared client keeps connections warm.
"""

from __future__ import annotations

import asyncio
from collections.abc import Coroutine
from typing import Any

import httpx

_client: httpx.AsyncClient | None = None
_background: set[asyncio.Task[Any]] = set()


_client_loop: asyncio.AbstractEventLoop | None = None


def shared_client() -> httpx.AsyncClient:
    """A client is bound to the event loop that created it; the server runs one loop,
    but scripts and tests may start several, so a new loop gets its own client."""
    global _client, _client_loop
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if _client is None or _client.is_closed or _client_loop is not loop:
        _client_loop = loop
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(120.0, connect=10.0),
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=40,
                                keepalive_expiry=60.0),
        )
    return _client


async def close_shared_client() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


def fire_and_forget(coro: Coroutine[Any, Any, Any]) -> None:
    """Run bookkeeping (telemetry) off the reply path, keeping a reference so the
    task isn't garbage-collected mid-flight."""
    task = asyncio.create_task(coro)
    _background.add(task)
    task.add_done_callback(_background.discard)
