"""Single source of truth for plan definitions, limits, and pricing.

Port of packages/shared/src/plans.ts. Never duplicate these values anywhere else.
"""

from __future__ import annotations

from typing import Literal, TypedDict

PlanKey = Literal["explore", "pro"]
FeatureKey = Literal["chat", "voiceMinutes", "analyze", "connectors", "botMessages"]


class PlanLimits(TypedDict):
    chat: int
    voiceMinutes: int
    analyze: int
    connectors: int | None
    botMessages: int


class PlanConfig(TypedDict, total=False):
    key: PlanKey
    name: str
    priceCents: int
    priceDisplay: str
    interval: Literal["month"]
    includedCredits: int
    model: str
    limits: PlanLimits


PLANS: dict[str, PlanConfig] = {
    # Free forever with unlimited chat; the only gate is active routines.
    # Credits are retired: ``includedCredits`` only feeds the dormant ledger.
    "explore": {
        "key": "explore",
        "name": "Free",
        "priceCents": 0,
        "priceDisplay": "$0",
        "interval": "month",
        "includedCredits": 100,
        "model": "@cf/zai-org/glm-5.3-flash",
        "limits": {
            "chat": 100,
            "voiceMinutes": 20,
            "analyze": 25,
            "connectors": None,
            "botMessages": 20,
        },
    },
    "pro": {
        "key": "pro",
        "name": "Pro",
        "priceCents": 500,
        "priceDisplay": "$5",
        "interval": "month",
        "includedCredits": 300,
        "model": "@cf/zai-org/glm-5.3-flash",
        "limits": {
            "chat": 250,
            "voiceMinutes": 60,
            "analyze": 150,
            "connectors": None,
            "botMessages": 100,
        },
    },
}


class CreditPackConfig(TypedDict):
    key: Literal["credits_500", "credits_2000", "credits_6000"]
    name: str
    credits: int
    priceCents: int
    priceDisplay: str
    currency: Literal["USD"]


# Credit packs are retired (free chat is unlimited); kept empty so historical
# webhook payloads still resolve to nothing instead of erroring.
CREDIT_PACKS: dict[str, CreditPackConfig] = {}


def get_plan(key: str) -> PlanConfig:
    return PLANS.get(key) or PLANS["explore"]


def feature_limit(plan: str, feature: FeatureKey) -> int | None:
    return get_plan(plan)["limits"][feature]


def is_plan_key(key: str) -> bool:
    return key in PLANS


def get_credit_pack(key: str) -> CreditPackConfig | None:
    return CREDIT_PACKS.get(key)