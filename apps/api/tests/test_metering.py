import uuid
from datetime import datetime

from sqlalchemy.dialects.postgresql import insert as pg_insert

from yomi.db.models_app import UsageEvent
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


def test_usage_event_insert_uses_metadata_key():
    # The DB column is `metadata`, but the ORM attribute is `metadata_`. Passing
    # `metadata=` collides with Table.metadata and crashes ORM bulk persistence
    # with "MetaData object has no attribute '_bulk_update_tuples'".
    stmt = (
        pg_insert(UsageEvent)
        .values(
            user_id=uuid.UUID(int=1),
            kind="request_chat",
            model=None,
            input_tokens=0,
            output_tokens=0,
            cost_cents=0,
            credits_charged=0,
            status="done",
            metadata_={"reserveKind": "chat"},
        )
        .returning(UsageEvent.id)
    )
    compiled = stmt.compile()
    assert "metadata" in compiled.string
    assert compiled.params["metadata"] == {"reserveKind": "chat"}