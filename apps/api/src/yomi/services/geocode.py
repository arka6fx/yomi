"""Reverse geocoding via OpenStreetMap Nominatim: coordinates -> a place name.

Nominatim is free and keyless under its usage policy: an identifying
User-Agent, at most one request per second, and caching repeat lookups. Only
the coordinates are sent. Any failure returns None and callers fall back to raw
coordinates.
"""

from __future__ import annotations

import asyncio
import time

import httpx

from yomi.conf import settings
from yomi.logging import get_logger
from yomi.services.http_pool import shared_client

logger = get_logger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
_MIN_INTERVAL = 1.0
_CACHE_SIZE = 512
_cache: dict[tuple[float, float], str | None] = {}
_lock = asyncio.Lock()
_last_request = 0.0


def _label(address: dict[str, str], fallback: str) -> str:
    """'Indiranagar, Bengaluru, India' rather than Nominatim's full postal line."""
    local = next(
        (address[k] for k in ("neighbourhood", "suburb", "quarter", "village") if address.get(k)),
        "",
    )
    city = next(
        (address[k] for k in ("city", "town", "municipality", "county") if address.get(k)), ""
    )
    parts = [p for p in (local, city, address.get("country", "")) if p]
    return ", ".join(dict.fromkeys(parts)) or fallback


async def reverse(lat: float, lon: float) -> str | None:
    global _last_request
    key = (round(lat, 3), round(lon, 3))  # ~100 m; nearby pins share a lookup
    if key in _cache:
        return _cache[key]
    async with _lock:
        wait = _MIN_INTERVAL - (time.monotonic() - _last_request)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_request = time.monotonic()
        try:
            response = await shared_client().get(
                NOMINATIM_URL,
                params={"format": "jsonv2", "lat": lat, "lon": lon, "zoom": 16},
                headers={"User-Agent": f"Yomi/1.0 (+{settings.app_url})"},
                timeout=httpx.Timeout(6.0, connect=3.0),
            )
            response.raise_for_status()
            data = response.json()
        except Exception as exc:  # noqa: BLE001 — geocoding is best-effort
            logger.warning("nominatim reverse failed: %s", type(exc).__name__)
            return None
    place = _label(data.get("address") or {}, data.get("display_name") or "") or None
    if len(_cache) >= _CACHE_SIZE:
        _cache.pop(next(iter(_cache)))
    _cache[key] = place
    return place


async def describe_location(lat: float, lon: float) -> str:
    """The text the agent sees when someone shares a location."""
    place = await reverse(lat, lon)
    coords = f"{lat:.5f}, {lon:.5f}"
    return f"[shared location: {place} ({coords})]" if place else f"[shared location: {coords}]"
