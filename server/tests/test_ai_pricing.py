from yomi.shared.ai_pricing import (
    COMPOSIO_MICROS_PER_TOOL_CALL,
    TokenCounts,
    composio_cost_micros,
    cost_micros,
    micros_to_cents,
    micros_to_usd,
    resolve_model_price,
)


def test_model_price_exact():
    p = resolve_model_price("gpt-5.4-mini")
    assert p.input_per_m_tokens == 400_000
    assert p.output_per_m_tokens == 1_600_000
    assert p.cached_rate() == 40_000


def test_model_price_prefix():
    p = resolve_model_price("gpt-5.5-2026-01")
    assert p.input_per_m_tokens == 1_500_000


def test_model_price_catch_all():
    p = resolve_model_price("some-unknown-model")
    assert p.input_per_m_tokens == 10_000_000


def test_model_price_none():
    p = resolve_model_price(None)
    assert p is resolve_model_price("")


def test_cost_micros_matches_table():
    # gpt-5.4-mini: 400K in / 1.6M out per 1M tokens (micro-USD).
    micros = cost_micros(
        "gpt-5.4-mini",
        TokenCounts(input_tokens=1_000_000, output_tokens=1_000_000),
    )
    assert micros == 400_000 + 1_600_000


def test_cost_micros_cached_cheaper():
    full = cost_micros("gpt-5.5", TokenCounts(input_tokens=2_000_000))
    cached = cost_micros(
        "gpt-5.5",
        TokenCounts(input_tokens=2_000_000, cached_input_tokens=1_000_000),
    )
    assert cached < full
    # gpt-5.5: 1M fresh * 1.5 + 1M cached * 0.15 (in micro-USD)
    assert cost_micros(
        "gpt-5.5",
        TokenCounts(input_tokens=2_000_000, cached_input_tokens=1_000_000),
    ) == round(1_500_000 + 150_000)


def test_cost_micros_clamps_negatives():
    assert (
        cost_micros(
            "gpt-5.4-mini",
            TokenCounts(input_tokens=-5, output_tokens=-3, cached_input_tokens=-2),
        )
        == 0
    )


def test_composio_costs():
    assert composio_cost_micros(3) == 3 * COMPOSIO_MICROS_PER_TOOL_CALL
    assert composio_cost_micros(0) == 0


def test_currency_helpers():
    assert micros_to_cents(1_000_000) == 100
    assert micros_to_usd(1_000_000) == 1.0
    assert micros_to_cents(COMPOSIO_MICROS_PER_TOOL_CALL) == 0.03