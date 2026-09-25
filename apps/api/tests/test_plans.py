from yomi.shared.plans import (
    CREDIT_PACKS,
    PLANS,
    feature_limit,
    get_credit_pack,
    get_plan,
    is_plan_key,
)


def test_only_free_and_pro():
    assert set(PLANS) == {"explore", "pro"}
    assert PLANS["explore"]["name"] == "Free" and PLANS["explore"]["priceCents"] == 0
    assert PLANS["pro"]["priceCents"] == 500


def test_plan_models():
    assert PLANS["explore"]["model"] == "@cf/zai-org/glm-5.3-flash"
    assert PLANS["pro"]["model"] == "@cf/zai-org/glm-5.3-flash"


def test_get_plan_unknown_falls_back_to_explore():
    assert get_plan("nope")["key"] == "explore"
    assert get_plan("max")["key"] == "explore"
    assert get_plan("pro")["key"] == "pro"


def test_feature_limit():
    assert feature_limit("pro", "connectors") is None


def test_credit_packs_are_retired():
    assert CREDIT_PACKS == {}
    assert get_credit_pack("credits_500") is None


def test_is_plan_key():
    assert is_plan_key("pro")
    assert not is_plan_key("max")
