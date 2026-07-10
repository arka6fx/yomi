import { describe, expect, it } from "bun:test"
import { costMicros, microsToCents, microsToUsd, resolveModelPrice } from "./ai-pricing.js"

describe("resolveModelPrice", () => {
  it("matches known models exactly", () => {
    expect(resolveModelPrice("gpt-5.5").inputPerMTokens).toBe(1_500_000)
    expect(resolveModelPrice("gpt-5.4-mini").outputPerMTokens).toBe(1_600_000)
  })

  it("matches by prefix", () => {
    expect(resolveModelPrice("gpt-5.5-2026-01")).toEqual(resolveModelPrice("gpt-5.5"))
  })

  it("falls back to the conservative catch-all for unknown or null models", () => {
    const fallback = resolveModelPrice("claude-4")
    expect(fallback.inputPerMTokens).toBe(10_000_000)
    expect(resolveModelPrice(null)).toEqual(fallback)
  })
})

describe("costMicros", () => {
  it("prices a call at the per-million rate", () => {
    // 1M input + 1M output on gpt-5.5 = 1.5 + 6.0 USD.
    expect(costMicros("gpt-5.5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(
      7_500_000,
    )
  })

  it("bills cached input tokens at the discounted rate", () => {
    const full = costMicros("gpt-5.5", { inputTokens: 1_000_000 })
    const cached = costMicros("gpt-5.5", {
      inputTokens: 1_000_000,
      cachedInputTokens: 1_000_000,
    })
    expect(full).toBe(1_500_000)
    expect(cached).toBe(150_000) // 90% cheaper
  })

  it("clamps cached tokens to the input count and floors negatives", () => {
    expect(costMicros("gpt-5.5", { inputTokens: 10, cachedInputTokens: 999 })).toBe(
      costMicros("gpt-5.5", { inputTokens: 10, cachedInputTokens: 10 }),
    )
    expect(costMicros("gpt-5.5", { inputTokens: -5, outputTokens: -5 })).toBe(0)
  })

  it("returns an integer number of micros", () => {
    const c = costMicros("gpt-5.4-mini", { inputTokens: 1234, outputTokens: 567 })
    expect(Number.isInteger(c)).toBe(true)
  })
})

describe("unit conversions", () => {
  it("converts micros to cents and usd", () => {
    expect(microsToCents(1_500_000)).toBe(150)
    expect(microsToUsd(1_500_000)).toBe(1.5)
  })
})
