"""Chat completions via Cloudflare Workers AI (OpenAI-compatible endpoint).

Plain httpx transport returning the response JSON unchanged, so callers use
OpenAI-shaped dicts (choices/message/content/tool_calls) without the OpenAI
SDK. Raises RuntimeError when credentials are missing; HTTP failures raise
httpx.HTTPError for the caller to map.
"""

from __future__ import annotations

from typing import Any, Literal

import httpx

from yomi.conf import settings

Purpose = Literal["fast", "agent", "search"]

_PURPOSE_MODELS = {
    "fast": "workers_ai_fast_model",
    "agent": "workers_ai_agent_model",
    "search": "workers_ai_search_model",
}

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
) -> dict[str, Any]:
    """POST a chat completion; returns the decoded response JSON."""
    url, token, _ = chat_endpoint()
    payload: dict[str, Any] = {
        "model": model or model_for(purpose),
        "messages": messages,
    }
    if tools:
        payload["tools"] = tools
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as client:
        response = await client.post(
            url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
    if not isinstance(data, dict):
        raise RuntimeError("Invalid Workers AI response")
    return data


def first_message(data: dict[str, Any]) -> dict[str, Any]:
    """Extract choices[0].message as a plain dict; raises on malformed replies."""
    try:
        message = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Malformed Workers AI reply") from exc
    if not isinstance(message, dict):
        raise RuntimeError("Malformed Workers AI reply")
    return message
