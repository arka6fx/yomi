"""Single source of truth for plan definitions, limits, and pricing.

Port of packages/shared/src/plans.ts. Never duplicate these values anywhere else.
"""

from __future__ import annotations

from typing import Literal, TypedDict

PlanKey = Literal["explore", "pro", "max"]
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
    # Free, renews every month (not a one-time trial) — see the Explore
    # auto-renewal cron. Workers AI neurons keep the free tier's cost bounded.
    "explore": {
        "key": "explore",
        "name": "Explore",
        "priceCents": 0,
        "priceDisplay": "$0",
        "interval": "month",
        "includedCredits": 100,
        "model": "@cf/qwen/qwen3.8-27b",
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
        "model": "@cf/qwen/qwen3.8-27b",
        "limits": {
            "chat": 250,
            "voiceMinutes": 60,
            "analyze": 150,
            "connectors": None,
            "botMessages": 100,
        },
    },
    "max": {
        "key": "max",
        "name": "Max",
        "priceCents": 4000,
        "priceDisplay": "$40",
        "interval": "month",
        "includedCredits": 750,
        "model": "@cf/qwen/qwen3.8-27b",
        "limits": {
            "chat": 600,
            "voiceMinutes": 150,
            "analyze": 400,
            "connectors": None,
            "botMessages": 250,
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


# Keys stay stable since they map to fixed Dodo product IDs; credit costs are
# denominated in internal credits, independent of the underlying model vendor.
CREDIT_PACKS: dict[str, CreditPackConfig] = {
    "credits_500": {
        "key": "credits_500",
        "name": "85 credits",
        "credits": 85,
        "priceCents": 500,
        "priceDisplay": "$5",
        "currency": "USD",
    },
    "credits_2000": {
        "key": "credits_2000",
        "name": "250 credits",
        "credits": 250,
        "priceCents": 1500,
        "priceDisplay": "$15",
        "currency": "USD",
    },
    "credits_6000": {
        "key": "credits_6000",
        "name": "750 credits",
        "credits": 750,
        "priceCents": 4000,
        "priceDisplay": "$40",
        "currency": "USD",
    },
}


def get_plan(key: str) -> PlanConfig:
    return PLANS.get(key) or PLANS["explore"]


def feature_limit(plan: str, feature: FeatureKey) -> int | None:
    return get_plan(plan)["limits"][feature]


def is_plan_key(key: str) -> bool:
    return key in PLANS


def get_credit_pack(key: str) -> CreditPackConfig | None:
    return CREDIT_PACKS.get(key)