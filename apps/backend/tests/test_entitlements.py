from datetime import UTC, datetime, timedelta

from yomi.services.entitlements import (
    credit_renewal,
    effective_plan_for_user,
    has_billable_plan_access,
)


def test_effective_plan_user_defaults_explore():
    assert effective_plan_for_user({}) == "explore"
    assert effective_plan_for_user({"plan": "junk"}) == "explore"
    assert effective_plan_for_user({"plan": "max"}) == "max"


def test_explore_renewal_uses_trial_end():
    trial_end = datetime.now(UTC) + timedelta(days=5)
    kind, at = credit_renewal({"plan": "explore", "trial_end_date": trial_end})
    assert kind == "renewal"
    assert at == trial_end


def test_explore_renewal_falls_back_to_created_at_plus_30d():
    created = datetime.now(UTC) - timedelta(days=5)
    kind, at = credit_renewal({"trial_end_date": None, "created_at": created})
    assert kind == "renewal"
    assert at == created + timedelta(days=30)


def test_explore_renewal_none_when_no_dates():
    kind, at = credit_renewal({"plan": "explore"})
    assert kind == "none"
    assert at is None


def test_paid_renewal_uses_period_end():
    cpe = datetime.now(UTC) + timedelta(days=20)
    kind, at = credit_renewal({"plan": "pro", "current_period_end": cpe})
    assert kind == "renewal"
    assert at == cpe


def test_access_explore_active_within_trial():
    end = datetime.now(UTC) + timedelta(hours=1)
    assert has_billable_plan_access({"plan": "explore", "trial_end_date": end})


def test_access_explore_expired_without_trial():
    assert not has_billable_plan_access({"plan": "explore"})
    past = datetime.now(UTC) - timedelta(minutes=1)
    assert not has_billable_plan_access({"plan": "explore", "trial_end_date": past})


def test_access_paid_active_and_trialing():
    assert has_billable_plan_access({"plan": "pro", "subscription_status": "active"})
    assert has_billable_plan_access({"plan": "max", "subscription_status": "trialing"})


def test_access_past_due_grace_window():
    ref = datetime.now(UTC) - timedelta(days=3)
    assert has_billable_plan_access(
        {"plan": "pro", "subscription_status": "past_due", "current_period_end": ref}
    )
    too_old = datetime.now(UTC) - timedelta(days=10)
    assert not has_billable_plan_access(
        {"plan": "pro", "subscription_status": "past_due", "current_period_end": too_old}
    )


def test_access_inactive_rejected():
    assert not has_billable_plan_access({"plan": "pro", "subscription_status": "inactive"})