"""/api/llm — OpenAI-compatible proxy (apps/backend/src/routes/llm.ts).

The sidecar sends chat-completion requests here when OPENAI_API_KEY is
unavailable in the packaged env; the backend injects the real key server-side.
Authenticated — without it this route is an open relay. Usage is charged by the
caller up front via /interactions/reserve; nothing is charged here.
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from yomi.app.deps import get_current_user
from yomi.conf import settings

logger = logging.getLogger(__name__)

llm_router = APIRouter(prefix="/api/llm")

DEFAULT_OPENAI_BASE = "https://api.openai.com/v1"

MIRRORED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]


def ai_credits_base() -> str:
    return (settings.openai_base_url or DEFAULT_OPENAI_BASE).rstrip("/")


async def _proxy_handler(
    request: Request,
    upstream_path: str,
    user=Depends(get_current_user),  # noqa: B008
):
    api_key = settings.openai_api_key
    if not api_key:
        return JSONResponse({"error": "OPENAI_API_KEY not configured"}, 500)

    body = await request.body()

    headers: dict[str, str] = {"Authorization": f"Bearer {api_key}"}
    content_type = request.headers.get("content-type")
    if content_type:
        headers["Content-Type"] = content_type

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            upstream = await client.request(
                request.method,
                f"{ai_credits_base()}/{upstream_path}",
                headers=headers,
                content=body or None,
            )
    except httpx.HTTPError as err:
        logger.error("[yomi/llm] upstream request failed: %s", err)
        return JSONResponse({"error": f"OpenAI upstream failed ({err})", "detail": ""}, 502)

    if upstream.status_code >= 400:
        detail = upstream.text
        return JSONResponse(
            {"error": f"OpenAI upstream failed ({upstream.status_code})", "detail": detail},
            upstream.status_code,
        )

    ct = upstream.headers.get("content-type") or ""
    response_headers = {"Content-Type": ct}
    if "text/event-stream" in ct or "application/json" in ct:
        response_headers["Cache-Control"] = "no-store"
    return StreamingResponse(
        upstream.aiter_bytes(),
        status_code=upstream.status_code,
        headers=response_headers,
    )


# Register each method separately (distinct route names → unique OpenAPI
# operation IDs); the single TS handler serves every verb.
for _method in MIRRORED_METHODS:
    llm_router.add_api_route(
        "/proxy/{upstream_path:path}",
        _proxy_handler,
        methods=[_method],
        name=f"llm_proxy_{_method.lower()}",
    )


@llm_router.post("/stream")
async def legacy_stream() -> Response:
    return JSONResponse({"error": "Use POST /api/llm/proxy/chat/completions instead"}, 410)