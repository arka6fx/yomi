"""Model API pricing and cost computation.

Port of packages/shared/src/ai-pricing.ts. Money is integer micro-USD
(1 USD = 1_000_000 micros) to avoid float drift; rates are micro-USD per 1M tokens.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelPrice:
    input_per_m_tokens: int
    output_per_m_tokens: int
    cached_input_per_m_tokens: int | None = None

    def cached_rate(self) -> int:
        if self.cached_input_per_m_tokens is not None:
            return self.cached_input_per_m_tokens
        return self.input_per_m_tokens


# Workers AI bills in neurons ($0.011 / 1K past the daily free allocation).
# Current models publish per-token equivalents, used here for informational
# cost estimates only; they never drive charging (see credit_ledger). Legacy
# rows read 0.
_MODEL_PRICES: dict[str, ModelPrice] = {
    "@cf/zai-org/glm-5.3-flash": ModelPrice(150_000, 500_000, 30_000),
    "@cf/qwen/qwen3.8-27b": ModelPrice(0, 0, 0),
    "@cf/meta/llama-3.1-8b-instruct": ModelPrice(0, 0, 0),
    "@cf/baai/bge-base-en-v1.5": ModelPrice(0, 0),
    # Catch-all for unknown models — deliberately conservative (never under-bills).
    "*": ModelPrice(10_000_000, 40_000_000),
}


# Priority: exact match -> prefix match -> catch-all.
def resolve_model_price(model: str | None) -> ModelPrice:
    if model:
        exact = _MODEL_PRICES.get(model)
        if exact:
            return exact
        for key, price in _MODEL_PRICES.items():
            if key != "*" and model.startswith(key):
                return price
    return _MODEL_PRICES["*"]


# Composio bills per tool call, not per token. Micro-USD per call.
COMPOSIO_MICROS_PER_TOOL_CALL = 300


def composio_cost_micros(calls: int) -> int:
    return max(0, int(calls)) * COMPOSIO_MICROS_PER_TOOL_CALL


@dataclass(frozen=True)
class TokenCounts:
    input_tokens: int = 0
    output_tokens: int = 0
    # Subset of input tokens served from cache; billed at the cached rate.
    cached_input_tokens: int = 0


def cost_micros(model: str | None, tokens: TokenCounts) -> int:
    price = resolve_model_price(model)
    inp = max(0, int(tokens.input_tokens))
    output = max(0, int(tokens.output_tokens))
    cached = min(max(0, int(tokens.cached_input_tokens)), inp)
    rate = price.cached_rate()
    micros = (
        ((inp - cached) * price.input_per_m_tokens)
        + (cached * rate)
        + (output * price.output_per_m_tokens)
    ) / 1_000_000
    return round(micros)


def micros_to_cents(micros: int | float) -> float:
    return micros / 10_000


def micros_to_usd(micros: int | float) -> float:
    return micros / 1_000_000