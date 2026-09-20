"""Credit cost per usage kind.

Port of apps/backend/src/services/credit-pricing.ts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

UsageCreditKind = Literal["chat", "voice", "analyze", "bot_message", "agent", "composio_tool"]
BillableUsageKind = UsageCreditKind

# Flat cost per interaction TYPE, tiered by real cost. A fast chat/image answer
# is one LLM call; an agent run (a Telegram message) does multi-step tool work,
# so it costs more. None matrix for future row/column pricing.
CREDIT_COSTS: dict[UsageCreditKind, int] = {
    "chat": 1,
    "voice": 2,
    "analyze": 1,
    "bot_message": 3,
    "agent": 3,
    "composio_tool": 1,
}


@dataclass
class UsagePricingInput:
    duration_seconds: int | None = None
    units: int | None = None
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


def credit_cost(kind: UsageCreditKind, units: int = 1) -> int:
    return CREDIT_COSTS[kind] * max(units, 1)


def credits_for_usage(kind: BillableUsageKind, input_: UsagePricingInput | None = None) -> int:
    inp = input_ or UsagePricingInput()
    if kind == "voice":
        minutes = max(-(-(inp.duration_seconds or 60) // 60), 1)
        return credit_cost(kind, minutes)
    if kind == "composio_tool":
        return credit_cost(kind, inp.units or 1)
    return credit_cost(kind)