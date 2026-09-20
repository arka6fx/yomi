"""Entitlements: effective plan/role, renewal dates, billable access.

Port of apps/backend/src/entitlements.ts.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TypedDict

from yomi.shared.plans import PLANS, PlanConfig, get_plan
from yomi.shared.plans import feature_limit as plan_feature_limit

TRIAL_MS = 30 * 24 * 60 * 60 * 1000


class EntitlementUser(TypedDict, total=False):
    id: str | None
    email: str | None
    role: str | None
    plan: str | None
    subscription_status: str | None
    current_period_end: datetime | None
    trial_end_date: datetime | None
    created_at: datetime | None


def effective_role_for_user(user: EntitlementUser) -> str:
    return user.get("role") or "user"


def effective_plan_for_user(user: EntitlementUser) -> str:
    plan = user.get("plan") or "explore"
    return plan if plan in PLANS else "explore"


def get_plan_config(user: EntitlementUser) -> PlanConfig:
    return get_plan(effective_plan_for_user(user))


def request_limit_for_user(user: EntitlementUser) -> int | None:
    return plan_feature_limit(effective_plan_for_user(user), "chat")


def feature_limit_for_user(user: EntitlementUser, feature: str) -> int | None:
    return plan_feature_limit(effective_plan_for_user(user), feature)  # type: ignore[arg-type]


def _now() -> datetime:
    return datetime.now(UTC)


def _as_utc(value: datetime | None) -> datetime | None:
    return value


def credit_renewal(user: EntitlementUser) -> tuple[str, datetime | None]:
    """Returns (kind, at) where kind is "renewal" | "none"."""
    if effective_plan_for_user(user) == "explore":
        trial_end = user.get("trial_end_date")
        if trial_end is None and user.get("created_at"):
            trial_end = user["created_at"] + timedelta(milliseconds=TRIAL_MS)
        return ("renewal", trial_end) if trial_end else ("none", None)
    cpe = user.get("current_period_end")
    return ("renewal", cpe) if cpe else ("none", None)


def has_billable_plan_access(user: EntitlementUser) -> bool:
    """Explore: trialEndDate not reached. Paid: active/trialing, or past_due within 7-day grace."""
    plan = effective_plan_for_user(user)
    now = _now()

    if plan == "explore":
        trial_end = user.get("trial_end_date")
        if trial_end is None:
            return False
        end = trial_end.replace(tzinfo=UTC) if trial_end.tzinfo is None else trial_end
        return now < end

    status = user.get("subscription_status")
    if status in ("active", "trialing"):
        return True

    if status == "past_due":
        ref = user.get("current_period_end") or now
        ref = ref.replace(tzinfo=UTC) if ref.tzinfo is None else ref
        grace_end = ref + timedelta(days=7)
        if now < grace_end:
            return True

    return False