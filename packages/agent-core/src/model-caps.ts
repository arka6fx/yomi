// Per-model capabilities table: context window and max output token caps.
// Used by createModel to clamp max_tokens requests against known model limits.
// Unknown models fall back to the default values.

export interface ModelCap {
  contextWindow: number
  maxOutput: number
}

const MODEL_CAPS: Record<string, ModelCap> = {
  // GPT-5.5 series
  "gpt-5.5": { contextWindow: 128_000, maxOutput: 16_384 },
  "gpt-5.5-mini": { contextWindow: 128_000, maxOutput: 16_384 },

  // Text models
  "text-embedding-3-small": { contextWindow: 8_191, maxOutput: 0 },

  // Catch-all for unprefixed model IDs
  "*": { contextWindow: 128_000, maxOutput: 8_192 },
}

// Priority: exact match → prefix match → catch-all
export function resolveModelCap(modelId: string): ModelCap {
  const exact = MODEL_CAPS[modelId]
  if (exact) return exact
  for (const [key, cap] of Object.entries(MODEL_CAPS)) {
    if (key !== "*" && modelId.startsWith(key)) return cap
  }
  return MODEL_CAPS["*"]!
}

// Resolve the effective max_tokens for a model call.
// Priority: caller-supplied value → env var → model default → global fallback.
export function resolveMaxTokens(modelId: string, callerMaxTokens?: number): number | undefined {
  const cap = resolveModelCap(modelId)
  if (cap.maxOutput === 0) return undefined

  const envMax = process.env["AI_CREDITS_MAX_TOKENS"]
    ? parseInt(process.env["AI_CREDITS_MAX_TOKENS"], 10)
    : undefined

  const desired = callerMaxTokens ?? envMax ?? Math.floor(cap.maxOutput * 0.5)
  return Math.min(desired, cap.maxOutput)
}
