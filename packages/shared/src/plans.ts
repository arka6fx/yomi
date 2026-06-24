// Single source of truth for all plan definitions, limits, and pricing.
// Every system derives from this: dashboard, billing, entitlements, quota enforcement.
// Do NOT duplicate these values anywhere else.

export interface PlanConfig {
  key: "explore" | "pro" | "max"
  name: string
  priceCents: number
  priceDisplay: string
  interval: "month"
  includedCredits: number

  limits: {
    chat: number
    voiceMinutes: number
    analyze: number
    connectors: number | null
    botMessages: number
  }
}

export const PLANS: Record<string, PlanConfig> = {
  explore: {
    key: "explore",
    name: "Explore",
    priceCents: 0,
    priceDisplay: "$0",
    interval: "month",
    includedCredits: 100,
    limits: {
      chat: 100,
      voiceMinutes: 20,
      analyze: 25,
      connectors: null,
      botMessages: 20,
    },
  },
  pro: {
    key: "pro",
    name: "Pro",
    priceCents: 1499,
    priceDisplay: "$14.99",
    interval: "month",
    includedCredits: 2500,
    limits: {
      chat: 2000,
      voiceMinutes: 180,
      analyze: 400,
      connectors: null,
      botMessages: 200,
    },
  },
  max: {
    key: "max",
    name: "Max",
    priceCents: 3999,
    priceDisplay: "$39.99",
    interval: "month",
    includedCredits: 10000,
    limits: {
      chat: 8000,
      voiceMinutes: 750,
      analyze: 2000,
      connectors: null,
      botMessages: 500,
    },
  },
}

export type PlanKey = keyof typeof PLANS
export type FeatureKey = keyof (typeof PLANS)["explore"]["limits"]
export type UsageCreditKind =
  | "chat"
  | "voice"
  | "analyze"
  | "bot_message"

export interface CreditPackConfig {
  key: "credits_500" | "credits_2000" | "credits_6000"
  name: string
  credits: number
  priceCents: number
  priceDisplay: string
  currency: "USD"
}

export const CREDIT_PACKS: Record<string, CreditPackConfig> = {
  credits_500: {
    key: "credits_500",
    name: "500 credits",
    credits: 500,
    priceCents: 499,
    priceDisplay: "$4.99",
    currency: "USD",
  },
  credits_2000: {
    key: "credits_2000",
    name: "2,000 credits",
    credits: 2000,
    priceCents: 1499,
    priceDisplay: "$14.99",
    currency: "USD",
  },
  credits_6000: {
    key: "credits_6000",
    name: "6,000 credits",
    credits: 6000,
    priceCents: 3999,
    priceDisplay: "$39.99",
    currency: "USD",
  },
}

export const CREDIT_COSTS: Record<UsageCreditKind, number> = {
  chat: 1,
  voice: 2,
  analyze: 1,
  bot_message: 1,
}

export function getPlan(key: string): PlanConfig {
  return (PLANS[key] ?? PLANS["explore"]) as PlanConfig
}

export function featureLimit(plan: string, feature: FeatureKey): PlanConfig["limits"][FeatureKey] {
  return getPlan(plan).limits[feature]
}

export function isPlanKey(key: string): key is PlanKey {
  return key in PLANS
}

export function getCreditPack(key: string): CreditPackConfig | null {
  return (CREDIT_PACKS[key] ?? null) as CreditPackConfig | null
}

export function creditCost(kind: UsageCreditKind, units = 1): number {
  return CREDIT_COSTS[kind] * Math.max(Math.ceil(units), 1)
}
