import pytest

from yomi.services.credit_pricing import (
    CREDIT_COSTS,
    UsagePricingInput,
    credits_for_usage,
)


def test_flat_costs():
    assert credits_for_usage("chat") == 1
    assert credits_for_usage("analyze") == 1
    assert credits_for_usage("bot_message") == 3
    assert credits_for_usage("agent") == 3
    assert CREDIT_COSTS["composio_tool"] == 1


def test_voice_minutes_round_up():
    assert credits_for_usage("voice") == 2  # default 60s -> 1 min
    assert credits_for_usage("voice", UsagePricingInput(duration_seconds=61)) == 4  # 2 min
    assert credits_for_usage("voice", UsagePricingInput(duration_seconds=180)) == 6  # 3 min
    assert credits_for_usage("voice", UsagePricingInput(duration_seconds=1)) == 2  # ceil 1 min


def test_composio_per_unit():
    assert credits_for_usage("composio_tool") == 1
    assert credits_for_usage("composio_tool", UsagePricingInput(units=3)) == 3


def test_invalid_kind_errors():
    with pytest.raises(KeyError):
        credits_for_usage("telepathy")  # type: ignore[arg-type]