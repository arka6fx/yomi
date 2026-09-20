from datetime import datetime

from yomi.services.metering import (
    CREDIT_KIND,
    EVENT_KIND,
    MeteringUser,
    _month_day,
    explore_renewal_label,
    low_credit_warning,
    next_month_reset_label,
)


def test_event_kind_mapping():
    assert EVENT_KIND["chat"] == "request_chat"
    assert EVENT_KIND["voice"] == "request_voice"
    assert EVENT_KIND["agent"] == "request_agent"
    assert EVENT_KIND["analyze"] == "analyze"
    assert EVENT_KIND["bot_message"] == "bot_message"
    assert EVENT_KIND["composio_tool"] == "composio_tool"


def test_credit_kind_all_mapped():
    assert set(CREDIT_KIND) == set(EVENT_KIND)
    assert CREDIT_KIND["composio_tool"] == "composio_tool"


def test_month_day():
    assert _month_day(datetime(2026, 9, 20)) == "September 20"
    assert _month_day(datetime(2026, 1, 3)) == "January 3"


def test_next_month_reset_label():
    # reset is first day of the following month
    label = next_month_reset_label()
    assert label.endswith(" 1")


def test_explore_renewal_label():
    user: MeteringUser = {"plan": "explore", "trial_end_date": datetime(2026, 10, 2)}
    assert explore_renewal_label(user) == "October 2"
    assert explore_renewal_label({"plan": "explore"}) == "next month"


def test_low_credit_warning_thresholds():
    user: MeteringUser = {"plan": "pro"}  # included 300
    assert low_credit_warning(user, 60) == "You have 60 credits left."
    assert low_credit_warning(user, 61) is None
    assert low_credit_warning(user, 1) == "You have 1 credits left."


def test_low_credit_warning_explore_fallback():
    # Unknown plans fall back to explore (included 100), so there's always a warning.
    user: MeteringUser = {"plan": "enterprise"}
    assert low_credit_warning(user, 0) == "You have 0 credits left."