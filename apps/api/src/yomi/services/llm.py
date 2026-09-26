"""Chat completions via Cloudflare Workers AI (OpenAI-compatible endpoint).

Plain httpx transport returning the response JSON unchanged, so callers use
OpenAI-shaped dicts (choices/message/content/tool_calls) without the OpenAI
SDK. Raises RuntimeError when credentials are missing; HTTP failures raise
httpx.HTTPError for the caller to map.
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Literal

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.conf import settings

logger = logging.getLogger(__name__)

Purpose = Literal["fast", "agent", "search"]

_PURPOSE_MODELS = {
    "fast": "workers_ai_fast_model",
    "agent": "workers_ai_agent_model",
    "search": "workers_ai_search_model",
}

# Reasoning models on Workers AI bill thinking as output tokens. Quick chat and
# search think briefly; agent runs (Max plan) think harder. Models that don't
# reason ignore the field.
_PURPOSE_EFFORT: dict[str, str] = {"fast": "low", "agent": "high", "search": "low"}

_REQUEST_TIMEOUT = httpx.Timeout(120.0)


def chat_endpoint() -> tuple[str, str, str]:
    """Return (url, bearer_token, default fast model); raises when unconfigured."""
    account = (settings.cloudflare_account_id or "").strip()
    token = (settings.cloudflare_api_token or "").strip()
    if not account or not token:
        raise RuntimeError(
            "Workers AI is not configured (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN)"
        )
    return (
        f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1/chat/completions",
        token,
        settings.workers_ai_fast_model,
    )


def model_for(purpose: Purpose) -> str:
    model = getattr(settings, _PURPOSE_MODELS[purpose], "")
    if not model:
        raise RuntimeError(f"No Workers AI model configured for purpose {purpose!r}")
    return model


async def chat_completion(
    purpose: Purpose,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    model: str | None = None,
    timeout: float = 120.0,
    user_id: str | None = None,
    db_session: AsyncSession | None = None,
    d1: Any = None,
    endpoint: str = "agent",
) -> dict[str, Any]:
    """POST a chat completion; returns the decoded response JSON."""
    url, token, _ = chat_endpoint()
    request_id = str(uuid.uuid4())
    started = time.perf_counter()
    selected_model = model or model_for(purpose)
    payload: dict[str, Any] = {
        "model": selected_model,
        "messages": messages,
    }
    if tools:
        payload["tools"] = tools
    effort = _PURPOSE_EFFORT.get(purpose)
    if effort:
        payload["reasoning_effort"] = effort
    try:
        from yomi.services.http_pool import shared_client

        response = await shared_client().post(
            url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
            timeout=httpx.Timeout(timeout, connect=10.0),
        )
        response.raise_for_status()
        data = response.json()
    except Exception as exc:
        logger.warning(
            "workers_ai_completion_failed request_id=%s purpose=%s model=%s latency_ms=%d error=%s",
            request_id, purpose, selected_model, int((time.perf_counter() - started) * 1000),
            type(exc).__name__,
        )
        if user_id and (db_session or d1):
            await _record_completion_telemetry(
                db_session, user_id, request_id, endpoint, purpose, selected_model,
                int((time.perf_counter() - started) * 1000), None, type(exc).__name__, d1,
            )
        raise
    if not isinstance(data, dict):
        raise RuntimeError("Invalid Workers AI response")
    latency_ms = int((time.perf_counter() - started) * 1000)
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    logger.info(
        "workers_ai_completion request_id=%s purpose=%s model=%s latency_ms=%d "
        "input_tokens=%s output_tokens=%s",
        request_id, purpose, selected_model, latency_ms,
        usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0),
    )
    if user_id and (db_session or d1):
        if d1 is not None and db_session is None:
            # A D1 write costs a gateway round trip; never make the reply wait on it.
            from yomi.services.http_pool import fire_and_forget

            fire_and_forget(_record_completion_telemetry(
                None, user_id, request_id, endpoint, purpose, selected_model,
                latency_ms, usage, None, d1,
            ))
        else:
            await _record_completion_telemetry(
                db_session, user_id, request_id, endpoint, purpose, selected_model,
                latency_ms, usage, None, d1,
            )
    return data


async def _record_completion_telemetry(
    session: AsyncSession | None,
    user_id: str,
    request_id: str,
    endpoint: str,
    purpose: Purpose,
    model: str,
    latency_ms: int,
    usage: dict[str, Any] | None,
    error_code: str | None,
    d1: Any = None,
) -> None:
    """Persist only numeric/provider metadata; never conversation content."""
    from yomi.services.ai_telemetry import AiUsageRecord, record_ai_usage

    usage = usage or {}
    try:
        record = AiUsageRecord(
            user_id=user_id,
            request_id=request_id,
            endpoint=endpoint,
            surface="agent",
            status="error" if error_code else "done",
            route=purpose,
            model=model,
            provider="workers-ai",
            input_tokens=int(usage.get("prompt_tokens") or 0),
            output_tokens=int(usage.get("completion_tokens") or 0),
            latency_ms=latency_ms,
            error_code=error_code,
            metadata={"purpose": purpose},
        )
        if d1 is not None:
            from yomi.services import billing_d1

            await billing_d1.record_ai_usage(d1, record)
        elif session is not None:
            await record_ai_usage(session, record)
    except Exception:  # telemetry is strictly best-effort
        logger.debug("workers ai telemetry persistence failed", exc_info=True)


def first_message(data: dict[str, Any]) -> dict[str, Any]:
    """Extract choices[0].message as a plain dict; raises on malformed replies."""
    try:
        message = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Malformed Workers AI reply") from exc
    if not isinstance(message, dict):
        raise RuntimeError("Malformed Workers AI reply")
    return message
