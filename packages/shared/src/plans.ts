// Single source of truth for all plan definitions, limits, and pricing.
// Every system derives from this: dashboard, billing, entitlements, quota enforcement.
// Do NOT duplicate these values anywhere else.

export interface PlanConfig {
  key: "explore" | "pro" | "max"
  name: string
  priceCents: number
  priceDisplay: string
  interval: "month"

  limits: {
    chat: number
    voiceMinutes: number
    screenshots: number
    reasoning: number
    desktopAutomation: number
    browserAutomation: number
    gatewayMessages: number
  }
}

export const PLANS: Record<string, PlanConfig> = {
  explore: {
    key: "explore",
    name: "Explore",
    priceCents: 0,
    priceDisplay: "$0",
    interval: "month",
    limits: {
      chat: 100,
      voiceMinutes: 20,
      screenshots: 25,
      reasoning: 5,
      desktopAutomation: 10,
      browserAutomation: 10,
      gatewayMessages: 50,
    },
  },
  pro: {
    key: "pro",
    name: "Pro",
    priceCents: 1499,
    priceDisplay: "$14.99",
    interval: "month",
    limits: {
      chat: 2000,
      voiceMinutes: 180,
      screenshots: 400,
      reasoning: 100,
      desktopAutomation: 75,
      browserAutomation: 40,
      gatewayMessages: 2000,
    },
  },
  max: {
    key: "max",
    name: "Max",
    priceCents: 3999,
    priceDisplay: "$39.99",
    interval: "month",
    limits: {
      chat: 8000,
      voiceMinutes: 750,
      screenshots: 2000,
      reasoning: 500,
      desktopAutomation: 750,
      browserAutomation: 500,
      gatewayMessages: 8000,
    },
  },
}

export type PlanKey = keyof typeof PLANS
export type FeatureKey = keyof (typeof PLANS)["explore"]["limits"]

export function getPlan(key: string): PlanConfig {
  return PLANS[key] ?? PLANS.explore
}

export function featureLimit(plan: string, feature: FeatureKey): number {
  return getPlan(plan).limits[feature]
}

export function isPlanKey(key: string): key is PlanKey {
  return key in PLANS
}
