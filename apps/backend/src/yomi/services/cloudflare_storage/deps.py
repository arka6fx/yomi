"""FastAPI dependency for the D1 + Vectorize backend slice.

Yields a request-scoped ``D1Backend`` (store + vector client) when
``storage_backend == "d1"``. D1 is the default; routes branch on ``use_d1()``
and keep a Postgres code path for legacy deployments.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import httpx
from fastapi import HTTPException

from yomi.conf import settings
from yomi.services.cloudflare_storage.client import StorageClient
from yomi.services.cloudflare_storage.store import D1Store


def use_d1() -> bool:
    return settings.storage_backend == "d1"


@dataclass
class D1Backend:
    store: D1Store
    client: StorageClient


@asynccontextmanager
async def open_d1_backend() -> AsyncIterator[D1Backend]:
    """Self-owned backend for background tasks and scripts (no request scope)."""
    async with httpx.AsyncClient() as http:
        client = StorageClient.configured(http)
        yield D1Backend(store=D1Store(client), client=client)


async def get_d1_backend():
    """None when the Postgres backend is active, so unconfigured gateways
    never affect Postgres traffic."""
    if not use_d1():
        yield None
        return
    try:
        async with httpx.AsyncClient() as http:
            client = StorageClient.configured(http)
            yield D1Backend(store=D1Store(client), client=client)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
