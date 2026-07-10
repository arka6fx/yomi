// Single source of truth for model API pricing and cost computation.
// Money is integer micro-USD (1 USD = 1_000_000 micros) to avoid float drift.
// Rates are micro-USD per 1M tokens. Previously these numbers were duplicated
// as cents-per-1K in apps/backend/routes/admin.ts and
// apps/sidecar/insights/insights-engine.ts — both derive from here now.

export interface ModelPrice {
  inputPerMTokens: number
  outputPerMTokens: number
  // OpenAI bills cached input at a discount; defaults to the input rate when unset.
  cachedInputPerMTokens?: number
}

// micro-USD per 1M tokens. gpt-5.x cached input is ~10% of the input rate.
const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-5.5": { inputPerMTokens: 1_500_000, outputPerMTokens: 6_000_000, cachedInputPerMTokens: 150_000 },
  "gpt-5.4-mini": { inputPerMTokens: 400_000, outputPerMTokens: 1_600_000, cachedInputPerMTokens: 40_000 },
  "text-embedding-3-small": { inputPerMTokens: 20_000, outputPerMTokens: 0 },
  // Catch-all for unknown models — deliberately conservative (never under-bills).
  "*": { inputPerMTokens: 10_000_000, outputPerMTokens: 40_000_000 },
}

// Priority: exact match → prefix match → catch-all. Mirrors resolveModelCap.
export function resolveModelPrice(model: string | null | undefined): ModelPrice {
  if (model) {
    const exact = MODEL_PRICES[model]
    if (exact) return exact
    for (const [key, price] of Object.entries(MODEL_PRICES)) {
      if (key !== "*" && model.startsWith(key)) return price
    }
  }
  return MODEL_PRICES["*"]!
}

export interface TokenCounts {
  inputTokens?: number
  outputTokens?: number
  // Subset of inputTokens served from cache; billed at the cached rate.
  cachedInputTokens?: number
}

// Total API cost in integer micro-USD for a single model call.
export function costMicros(model: string | null | undefined, tokens: TokenCounts): number {
  const price = resolveModelPrice(model)
  const input = Math.max(0, Math.floor(tokens.inputTokens ?? 0))
  const output = Math.max(0, Math.floor(tokens.outputTokens ?? 0))
  const cached = Math.min(Math.max(0, Math.floor(tokens.cachedInputTokens ?? 0)), input)
  const cachedRate = price.cachedInputPerMTokens ?? price.inputPerMTokens
  const micros =
    ((input - cached) * price.inputPerMTokens +
      cached * cachedRate +
      output * price.outputPerMTokens) /
    1_000_000
  return Math.round(micros)
}

export function microsToCents(micros: number): number {
  return micros / 10_000
}

export function microsToUsd(micros: number): number {
  return micros / 1_000_000
}
