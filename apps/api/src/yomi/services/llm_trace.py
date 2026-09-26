"""LLM call traces to Langfuse (free Hobby tier), metadata only.

Off until LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set. Each Workers AI
call becomes one OpenTelemetry span, posted as OTLP/JSON to Langfuse's
/api/public/otel/v1/traces (the legacy /api/public/ingestion stops accepting
traces on 2026-11-16). The span carries model, purpose, endpoint, latency,
token counts and error code. Prompts and replies are never sent: Yomi's privacy
rule is that telemetry holds no conversation content. The user id is hashed.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import time
import uuid
from typing import Any

import httpx

from yomi.conf import settings
from yomi.logging import get_logger

logger = get_logger(__name__)

OTEL_PATH = "/api/public/otel/v1/traces"
_SPAN_KIND_CLIENT = 3
_STATUS_OK, _STATUS_ERROR = 1, 2


def enabled() -> bool:
    return bool(settings.langfuse_public_key and settings.langfuse_secret_key)


def _attr(key: str, value: str | int | list[str]) -> dict[str, Any]:
    if isinstance(value, list):
        wrapped: dict[str, Any] = {"arrayValue": {"values": [{"stringValue": v} for v in value]}}
    elif isinstance(value, int):
        wrapped = {"intValue": str(value)}  # OTLP/JSON encodes int64 as a string
    else:
        wrapped = {"stringValue": value}
    return {"key": key, "value": wrapped}


def _trace_id(request_id: str) -> str:
    try:
        return uuid.UUID(request_id).hex
    except ValueError:
        return hashlib.sha256(request_id.encode()).hexdigest()[:32]


def build_payload(
    *,
    request_id: str,
    endpoint: str,
    purpose: str,
    model: str,
    latency_ms: int,
    usage: dict[str, Any] | None,
    error_code: str | None,
    user_id: str | None,
    ended_ns: int | None = None,
) -> dict[str, Any]:
    end = ended_ns or time.time_ns()
    start = end - latency_ms * 1_000_000
    usage = usage or {}
    input_tokens = int(usage.get("prompt_tokens") or 0)
    output_tokens = int(usage.get("completion_tokens") or 0)
    attributes = [
        _attr("langfuse.observation.type", "generation"),
        _attr("langfuse.observation.model.name", model),
        _attr("langfuse.observation.level", "ERROR" if error_code else "DEFAULT"),
        _attr("langfuse.observation.usage_details",
              json.dumps({"input": input_tokens, "output": output_tokens})),
        _attr("gen_ai.usage.input_tokens", input_tokens),
        _attr("gen_ai.usage.output_tokens", output_tokens),
        _attr("langfuse.observation.metadata.purpose", purpose),
        _attr("langfuse.observation.metadata.provider", "workers-ai"),
        _attr("langfuse.trace.name", endpoint),
        _attr("langfuse.trace.tags", [purpose, settings.environment]),
    ]
    if error_code:
        attributes.append(_attr("langfuse.observation.status_message", error_code))
    if user_id:
        attributes.append(
            _attr("langfuse.user.id", hashlib.sha256(user_id.encode()).hexdigest()[:16])
        )
    span = {
        "traceId": _trace_id(request_id),
        "spanId": secrets.token_hex(8),
        "name": f"{endpoint}:{purpose}",
        "kind": _SPAN_KIND_CLIENT,
        "startTimeUnixNano": str(start),
        "endTimeUnixNano": str(end),
        "attributes": attributes,
        "status": {"code": _STATUS_ERROR, "message": error_code}
        if error_code
        else {"code": _STATUS_OK},
    }
    return {"resourceSpans": [{
        "resource": {"attributes": [
            _attr("service.name", "yomi-api"),
            _attr("deployment.environment", settings.environment),
        ]},
        "scopeSpans": [{"scope": {"name": "yomi.llm"}, "spans": [span]}],
    }]}


async def send_trace(**fields: Any) -> None:
    """Best-effort; callers run this with fire_and_forget off the reply path."""
    if not enabled():
        return
    from yomi.services.http_pool import shared_client

    try:
        response = await shared_client().post(
            f"{settings.langfuse_host.rstrip('/')}{OTEL_PATH}",
            auth=(settings.langfuse_public_key, settings.langfuse_secret_key),
            headers={"x-langfuse-ingestion-version": "4"},
            json=build_payload(**fields),
            timeout=httpx.Timeout(8.0, connect=4.0),
        )
        response.raise_for_status()
    except Exception as exc:  # noqa: BLE001 — tracing must never affect replies
        logger.debug("langfuse otel export failed: %s", type(exc).__name__)
