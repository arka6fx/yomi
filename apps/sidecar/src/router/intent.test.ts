import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test"
import type { IntentClassification } from "@yomi/shared"

// Track whether classifyWithLlm was called
let llmCallCount = 0
let llmResult: IntentClassification = { path: "agent", confidence: 0.9, reason: "mocked", source: "llm" }
let llmShouldThrow = false

mock.module("./llm.js", () => ({
  classifyWithLlm: async () => {
    llmCallCount++
    if (llmShouldThrow) throw new Error("timeout")
    return llmResult
  },
}))

// Import AFTER mock.module so the mock takes effect
const { classifyIntent } = await import("./intent.js")

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

describe("classifyIntent", () => {
  beforeEach(() => {
    llmCallCount = 0
    llmShouldThrow = false
    llmResult = { path: "agent", confidence: 0.9, reason: "mocked", source: "llm" }
  })

  afterEach(() => {
    delete process.env.ROUTER_LLM_ENABLED
    delete process.env.ROUTER_HEURISTIC_THRESHOLD
  })

  it("uses heuristic and skips LLM when LLM is disabled (Phase 0 default)", async () => {
    // LLM_ENABLED defaults to false unless env is "true"
    setEnv("ROUTER_LLM_ENABLED", undefined)
    const result = await classifyIntent({ text: "send an email to Alice" })
    expect(result.source).toBe("heuristic")
    expect(llmCallCount).toBe(0)
  })

  it("uses heuristic when confidence >= threshold, even with LLM enabled", async () => {
    setEnv("ROUTER_LLM_ENABLED", "true")
    setEnv("ROUTER_HEURISTIC_THRESHOLD", "0.5")
    // "yomi, agent, ..." → confidence 0.95 which exceeds 0.5 threshold
    const result = await classifyIntent({ text: "yomi, agent, book a flight" })
    expect(result.source).toBe("heuristic")
    expect(llmCallCount).toBe(0)
    expect(result.path).toBe("agent")
  })

  it("calls LLM when heuristic confidence is below threshold and LLM is enabled", async () => {
    setEnv("ROUTER_LLM_ENABLED", "true")
    setEnv("ROUTER_HEURISTIC_THRESHOLD", "0.8")
    llmResult = { path: "agent", confidence: 0.85, reason: "action verb", source: "llm" }
    // "hello" → heuristic returns 0.5 confidence, below 0.8 threshold
    const result = await classifyIntent({ text: "hello" })
    expect(result.source).toBe("llm")
    expect(llmCallCount).toBe(1)
    expect(result.path).toBe("agent")
  })

  it("falls back to heuristic when LLM throws", async () => {
    setEnv("ROUTER_LLM_ENABLED", "true")
    setEnv("ROUTER_HEURISTIC_THRESHOLD", "0.8")
    llmShouldThrow = true
    const result = await classifyIntent({ text: "hello" })
    expect(result.source).toBe("heuristic")
    expect(llmCallCount).toBe(1)  // LLM was attempted
  })

  it("returns the LLM result including its path when LLM is called", async () => {
    setEnv("ROUTER_LLM_ENABLED", "true")
    setEnv("ROUTER_HEURISTIC_THRESHOLD", "0.8")
    llmResult = { path: "fast", confidence: 0.75, reason: "llm says fast", source: "llm" }
    const result = await classifyIntent({ text: "hello" })
    // LLM should have been called (heuristic confidence 0.3 < 0.8 threshold)
    expect(llmCallCount).toBe(1)
    expect(result.source).toBe("llm")
    expect(result.path).toBe("fast")
    expect(result.reason).toBe("llm says fast")
  })
})
