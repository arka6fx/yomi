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
  // Agent-loop model for this plan's Telegram turns. gpt-5.4-mini is ~3.75x
  // cheaper than gpt-5.5 on both input and output tokens — routing the
  // cost-sensitive tiers through it is what makes their credit allotments
  // affordable at 70% margin. Max keeps the flagship model as its differentiator.
  model: string

  limits: {
    chat: number
    voiceMinutes: number
    analyze: number
    connectors: number | null
    botMessages: number
  }
}

// Credit budgets below are sized against real OpenAI cost from ai_usage_events
// telemetry (~$0.037/Telegram message on gpt-5.5, ~$0.0099 on gpt-5.4-mini,
// pre-cache-fix), targeting 70% gross margin on each plan's net-of-Dodo-fees-
// and-GST revenue. Revisit once the prompt-cache fix (agent-core
// cachedInputTokens) is live and real cost is re-measured — these are a
// conservative floor, not a ceiling.
export const PLANS: Record<string, PlanConfig> = {
  // Free, renews every month (not a one-time trial) — see the Explore
  // auto-renewal cron. gpt-5.4-mini keeps the free tier's cost bounded
  // indefinitely regardless of how many people stay on it forever.
  explore: {
    key: "explore",
    name: "Explore",
    priceCents: 0,
    priceDisplay: "$0",
    interval: "month",
    includedCredits: 100,
    model: "gpt-5.4-mini",
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
    priceCents: 500,
    priceDisplay: "$5",
    interval: "month",
    includedCredits: 300,
    model: "gpt-5.4-mini",
    limits: {
      chat: 250,
      voiceMinutes: 60,
      analyze: 150,
      connectors: null,
      botMessages: 100,
    },
  },
  max: {
    key: "max",
    name: "Max",
    priceCents: 4000,
    priceDisplay: "$40",
    interval: "month",
    includedCredits: 750,
    model: "gpt-5.5",
    limits: {
      chat: 600,
      voiceMinutes: 150,
      analyze: 400,
      connectors: null,
      botMessages: 250,
    },
  },
}

export type PlanKey = keyof typeof PLANS
export type FeatureKey = keyof (typeof PLANS)["explore"]["limits"]

export interface CreditPackConfig {
  key: "credits_500" | "credits_2000" | "credits_6000"
  name: string
  credits: number
  priceCents: number
  priceDisplay: string
  currency: "USD"
}

// Credit packs are a shared currency purchasable by any plan, including Max
// (routed to gpt-5.5, ~3.75x costlier per credit than Explore/Pro's
// gpt-5.4-mini) — so they must be priced safe against that worst case, not
// against the cheap-model cost. Sized for 70% margin against ~$0.0123/credit
// real cost (gpt-5.5, pre-cache-fix). The `credits_*` keys stay stable since
// they map to fixed Dodo product IDs (DODO_LIVE_PRODUCT_CREDITS_*); only the
// credit amounts and display copy changed.
export const CREDIT_PACKS: Record<string, CreditPackConfig> = {
  credits_500: {
    key: "credits_500",
    name: "85 credits",
    credits: 85,
    priceCents: 500,
    priceDisplay: "$5",
    currency: "USD",
  },
  credits_2000: {
    key: "credits_2000",
    name: "250 credits",
    credits: 250,
    priceCents: 1500,
    priceDisplay: "$15",
    currency: "USD",
  },
  credits_6000: {
    key: "credits_6000",
    name: "750 credits",
    credits: 750,
    priceCents: 4000,
    priceDisplay: "$40",
    currency: "USD",
  },
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
