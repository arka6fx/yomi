"""/api/media — public reads of user-uploaded images (keys are unguessable UUIDs)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from yomi.services import media
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend

media_router = APIRouter(prefix="/api/media")


@media_router.get("/{key:path}")
async def read_media(key: str, d1: D1Backend | None = Depends(get_d1_backend)) -> Response:
    if d1 is None or not media.valid_key(key):
        raise HTTPException(status_code=404, detail="not found")
    found = await d1.client.media_read(key)
    if found is None:
        raise HTTPException(status_code=404, detail="not found")
    data, content_type = found
    return Response(
        content=data,
        media_type=content_type,
        headers={
            # Every upload gets a fresh key, so a stored object never changes.
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'",
        },
    )
