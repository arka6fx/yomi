"""LLM usage telemetry (content-shaped keys never stored).

Port of apps/api/src/services/ai-telemetry.ts.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.db.models_app2 import AiUsageEvent
from yomi.shared.ai_pricing import TokenCounts, cost_micros

logger = logging.getLogger(__name__)

# Content-shaped keys that must never reach telemetry storage (spec 22 non-goal).
BLOCKED_METADATA_KEYS = {
    "prompt",
    "messages",
    "content",
    "text",
    "transcript",
    "screenshot",
    "screenshots",
    "image",
    "images",
    "audio",
    "payload",
    "body",
}


@dataclass
class AiUsageRecord:
    user_id: str
    request_id: str
    endpoint: str
    surface: str
    status: str
    usage_event_id: str | None = None
    route: str | None = None
    intent: str | None = None
    complexity: str | None = None
    model: str | None = None
    provider: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    reasoning_tokens: int | None = None
    cached_input_tokens: int | None = None
    embedding_tokens: int | None = None
    max_output_tokens: int | None = None
    tool_calls: int | None = None
    connector_ids: list[str] | None = None
    vision_images: int | None = None
    voice_duration_seconds: int | None = None
    tts_chars: int | None = None
    stt_audio_seconds: int | None = None
    latency_ms: int | None = None
    first_token_latency_ms: int | None = None
    total_api_cost_micros: int | None = None
    credits_estimated: int | None = None
    credits_charged: int | None = None
    error_code: str | None = None
    metadata: dict | None = None


def sanitize_telemetry_metadata(meta: dict | None) -> dict | None:
    if not meta:
        return None
    out = {k: v for k, v in meta.items() if k.lower() not in BLOCKED_METADATA_KEYS}
    return out or None


def _clamp(value: int | None) -> int:
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    if value != value:  # NaN guard for float inputs
        return 0
    return max(0, int(value))


async def record_ai_usage(session: AsyncSession, input_: AiUsageRecord) -> None:
    total_cost = input_.total_api_cost_micros or 0
    if total_cost <= 0:
        total_cost = cost_micros(
            input_.model,
            TokenCounts(
                input_tokens=input_.input_tokens or 0,
                output_tokens=input_.output_tokens or 0,
                cached_input_tokens=input_.cached_input_tokens or 0,
            ),
        )
    try:
        await session.execute(
            pg_insert(AiUsageEvent)
            .values(
                user_id=input_.user_id,
                request_id=input_.request_id,
                usage_event_id=input_.usage_event_id,
                endpoint=input_.endpoint,
                surface=input_.surface,
                route=input_.route,
                intent=input_.intent,
                complexity=input_.complexity,
                model=input_.model,
                provider=(input_.provider or "workers-ai"),
                input_tokens=_clamp(input_.input_tokens),
                output_tokens=_clamp(input_.output_tokens),
                reasoning_tokens=_clamp(input_.reasoning_tokens),
                cached_input_tokens=_clamp(input_.cached_input_tokens),
                embedding_tokens=_clamp(input_.embedding_tokens),
                max_output_tokens=_clamp(input_.max_output_tokens),
                tool_calls=_clamp(input_.tool_calls),
                connector_count=len(input_.connector_ids or []),
                connector_ids=input_.connector_ids or [],
                vision_images=_clamp(input_.vision_images),
                voice_duration_seconds=_clamp(input_.voice_duration_seconds),
                tts_chars=_clamp(input_.tts_chars),
                stt_audio_seconds=_clamp(input_.stt_audio_seconds),
                latency_ms=_clamp(input_.latency_ms),
                first_token_latency_ms=(
                    max(0, int(input_.first_token_latency_ms))
                    if input_.first_token_latency_ms is not None
                    else None
                ),
                total_api_cost_micros=_clamp(total_cost),
                credits_estimated=_clamp(input_.credits_estimated),
                credits_charged=_clamp(input_.credits_charged),
                status=input_.status,
                error_code=input_.error_code,
                metadata_=sanitize_telemetry_metadata(input_.metadata),
                completed_at=datetime.now(UTC),
            )
            .on_conflict_do_nothing(index_elements=[AiUsageEvent.request_id])
        )
    except Exception as exc:  # best-effort: telemetry must never break a request path
        logger.warning("[ai-telemetry] recordAiUsage failed: %s", exc)