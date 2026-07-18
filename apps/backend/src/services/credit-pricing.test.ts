import { describe, expect, it } from "bun:test"
import { creditsForUsage } from "./credit-pricing.js"

describe("creditsForUsage tiers", () => {
  it("charges 1 credit for a fast chat or screen analyze", () => {
    expect(creditsForUsage("chat")).toBe(1)
    expect(creditsForUsage("analyze")).toBe(1)
  })

  it("charges the agent tier for multi-step agent and Telegram runs", () => {
    expect(creditsForUsage("agent")).toBe(3)
    expect(creditsForUsage("bot_message")).toBe(3)
  })

  it("charges voice per minute, rounding up", () => {
    expect(creditsForUsage("voice", { durationSeconds: 60 })).toBe(2)
    expect(creditsForUsage("voice", { durationSeconds: 90 })).toBe(4) // 2 min * 2
    expect(creditsForUsage("voice", { durationSeconds: 1 })).toBe(2)
  })

  it("charges composio tool calls per call, scaling with the call count", () => {
    expect(creditsForUsage("composio_tool", { units: 1 })).toBe(1)
    expect(creditsForUsage("composio_tool", { units: 5 })).toBe(5)
    // a turn with no explicit count defaults to one call
    expect(creditsForUsage("composio_tool")).toBe(1)
    // never charges less than one call's worth
    expect(creditsForUsage("composio_tool", { units: 0 })).toBe(1)
  })
})
