from yomi.shared.plans import (
    CREDIT_PACKS,
    PLANS,
    feature_limit,
    get_credit_pack,
    get_plan,
    is_plan_key,
)


def test_plans_present():
    assert set(PLANS) == {"explore", "pro", "max"}


def test_plan_facts():
    assert PLANS["explore"]["includedCredits"] == 100
    assert PLANS["explore"]["priceCents"] == 0
    assert PLANS["pro"]["includedCredits"] == 300
    assert PLANS["pro"]["priceCents"] == 500
    assert PLANS["max"]["includedCredits"] == 750
    assert PLANS["max"]["priceCents"] == 4000


def test_plan_models():
    assert PLANS["explore"]["model"] == "gpt-5.4-mini"
    assert PLANS["pro"]["model"] == "gpt-5.4-mini"
    assert PLANS["max"]["model"] == "gpt-5.5"


def test_get_plan_unknown_falls_back_to_explore():
    assert get_plan("nope")["key"] == "explore"
    assert get_plan("pro")["key"] == "pro"


def test_feature_limit():
    assert feature_limit("explore", "chat") == 100
    assert feature_limit("max", "voiceMinutes") == 150
    assert feature_limit("pro", "connectors") is None


def test_credit_packs():
    assert set(CREDIT_PACKS) == {"credits_500", "credits_2000", "credits_6000"}
    assert CREDIT_PACKS["credits_500"]["credits"] == 85
    assert CREDIT_PACKS["credits_500"]["priceCents"] == 500
    assert CREDIT_PACKS["credits_6000"]["priceCents"] == 4000
    assert get_credit_pack("credits_2000")["credits"] == 250
    assert get_credit_pack("junk") is None


def test_is_plan_key():
    assert is_plan_key("pro")
    assert not is_plan_key("enterprise")