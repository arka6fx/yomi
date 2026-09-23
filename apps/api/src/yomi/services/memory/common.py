"""Pure memory helpers shared by the Postgres routes and the D1 backend.

Moved verbatim from ``yomi.app.routes.memory`` so both storage paths apply
identical cleaning, hashing, clamping, and topic rules. No I/O here.
"""

from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from typing import Any

MAX_MEMORY_CHARS = 8_000
UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)


def _clean(value: Any, max_len: int) -> str:
    text = str(value or "").replace("\r", "")
    text = re.sub(r"data:image/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+", "[redacted image]", text)
    text = re.sub(r"[A-Za-z0-9+/=]{400,}", "[redacted base64]", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text[:max_len].strip()


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _clamp_limit(value: Any, fallback: int, max_value: int) -> int:
    try:
        n = int(str(value or ""))
    except (TypeError, ValueError):
        return fallback
    if n <= 0:
        return fallback
    return min(n, max_value)


def _clamp_confidence(value: Any) -> int:
    try:
        n = int(str(value if value is not None else "70"))
    except (TypeError, ValueError):
        return 70
    return max(0, min(100, n))


def _forget_after_date(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(UTC)
    except (TypeError, ValueError):
        return None


# Supersession by id is judged against candidates a model was shown. A request
# body carries no such judgment, so the API path keeps the conservative topic
# rule (ADR 0006).
def _from_api_body(input_data: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in input_data.items() if k not in ("replacesId", "modelJudged")}


def _normalize_topic(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# Topic equality only — the conservative path for writers with no conversational context (ADR 0006).
def relation_for_memory(input_data: dict[str, Any], candidate: dict[str, Any]) -> str | None:
    topic = _normalize_topic(str(input_data.get("topic") or input_data.get("summary") or ""))
    candidate_topic = _normalize_topic(str(candidate.get("topic") or ""))
    if topic and candidate_topic == topic:
        return "updates"
    return None
