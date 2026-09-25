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
    p = resolve_model_price("@cf/qwen/qwen3.8-27b")
    assert p.input_per_m_tokens == 0
    assert p.output_per_m_tokens == 0
    assert p.cached_rate() == 0


def test_glm_flash_price_is_published_rate():
    p = resolve_model_price("@cf/zai-org/glm-5.3-flash")
    assert (p.input_per_m_tokens, p.output_per_m_tokens, p.cached_rate()) == (
        150_000, 500_000, 30_000,
    )


def test_model_price_prefix():
    p = resolve_model_price("@cf/qwen/qwen3.8-27b-extra")
    assert p.input_per_m_tokens == 0


def test_model_price_catch_all():
    p = resolve_model_price("some-unknown-model")
    assert p.input_per_m_tokens == 10_000_000


def test_model_price_none():
    p = resolve_model_price(None)
    assert p is resolve_model_price("")


def test_cost_micros_matches_table():
    # Workers AI bills in neurons, not per token: telemetry estimates read 0.
    micros = cost_micros(
        "@cf/qwen/qwen3.8-27b",
        TokenCounts(input_tokens=1_000_000, output_tokens=1_000_000),
    )
    assert micros == 0


def test_cost_micros_cached_cheaper():
    full = cost_micros("@cf/meta/llama-3.1-8b-instruct", TokenCounts(input_tokens=2_000_000))
    cached = cost_micros(
        "@cf/meta/llama-3.1-8b-instruct",
        TokenCounts(input_tokens=2_000_000, cached_input_tokens=1_000_000),
    )
    assert cached <= full


def test_cost_micros_clamps_negatives():
    assert (
        cost_micros(
            "@cf/qwen/qwen3.8-27b",
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
