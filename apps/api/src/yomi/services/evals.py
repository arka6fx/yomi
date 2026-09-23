"""Small deterministic quality checks for agent replies.

These checks are intentionally model-agnostic. They catch regressions in the
transport/agent contract without storing user content or requiring a second LLM.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ReplyEval:
    passed: bool
    checks: dict[str, bool]


_INTERNAL_MARKERS = re.compile(
    r"(?:tool_call_id|<agent_soul>|chain[- ]of[- ]thought|raw payload)", re.I
)
_SUCCESS_CLAIMS = re.compile(r"\b(done|completed|sent|booked|purchased|deleted)\b", re.I)


def evaluate_reply(reply: str, *, tool_error: bool = False) -> ReplyEval:
    """Evaluate user-facing hygiene and honest completion claims."""
    text = reply.strip()
    checks = {
        "non_empty": bool(text),
        "no_internal_markers": not bool(_INTERNAL_MARKERS.search(text)),
        "no_unverified_success": not (tool_error and bool(_SUCCESS_CLAIMS.search(text))),
        "bounded_length": len(text) <= 20_000,
    }
    return ReplyEval(passed=all(checks.values()), checks=checks)
