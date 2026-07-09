/**
 * Focused regression coverage for the Task 4 fix in agentPipeline:
 *   - fullText now accumulates unconditionally (previously gated behind
 *     `if (ttsEnabled)`, so a text-only turn recorded nothing)
 *   - the pipeline records a user turn and an assistant turn into the
 *     per-conversation ConversationState keyed by `req.conversationId`
 *
 * This does NOT attempt to cover the full streamText tool-calling loop,
 * retries, rate limiting, or budget exhaustion — those are pre-existing,
 * unrelated behavior. Everything but the conversation-state module itself
 * is mocked so the turn runs without a real LLM call.
 *
 * Mocking strategy mirrors fast.test.ts: `mock.module()` calls are
 * registered before the module under test is imported so the module-level
 * `createModel()` / tool wiring inside agent.ts picks up the fakes.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test"
import type { Hooks } from "../harness/hooks.js"

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

let streamChunks: string[] = ["Hello", " world", "!"]

mock.module("ai", () => ({
  tool: (definition: unknown) => definition,
  jsonSchema: (schema: unknown) => schema,
  generateObject: async () => ({ object: {} }),
  generateText: async () => ({ text: "" }),
  streamText: (_opts: { messages?: unknown[]; [key: string]: unknown }) => {
    const chunks = [...streamChunks]
    return {
      textStream: (async function* () {
        for (const chunk of chunks) yield chunk
      })(),
      fullStream: (async function* () {
        for (const chunk of chunks) yield { type: "text-delta", textDelta: chunk }
      })(),
    }
  },
}))

mock.module("./model.js", () => ({
  createModel: (modelId: string) => ({ provider: "openai", modelId }),
}))

mock.module("./tts.js", () => ({
  resolveTts: () => "none" as const,
  synthesize: async function* () {},
}))

// Full tool-loading machinery (connectors, cron, subagent delegate, etc.) is
// irrelevant to turn-recording — replace with an empty tool set.
mock.module("../tools/index.js", () => ({
  createAgentTools: () => ({}),
}))

mock.module("../connectors/registry.js", () => ({
  getConnectorRegistry: () => ({ getConnected: () => [], getAllDefTools: () => ({}) }),
}))

// Avoid real disk I/O in the rate-limit circuit breaker (~/.yomi/rate-limit.json).
mock.module("../agent/rate-limiter.js", () => ({
  canProceed: async () => true,
  cooldownRemaining: async () => 0,
  recordRateLimit: async () => {},
  recordSuccess: async () => {},
  isRateLimitError: () => false,
  isBillingError: () => false,
  jitteredBackoff: () => 0,
  sleep: async () => {},
  RateLimitError: class RateLimitError extends Error {},
  BillingError: class BillingError extends Error {},
}))

// req.plan is left undefined in every test below, so memoryEnabled() is false
// and this module's exports are never called — mocked only to keep its heavy
// transitive imports (cloud-rag, chat-history, consolidation…) out of the run.
mock.module("../memory/subsystem.js", () => ({
  loadMemoryContext: async () => ({
    memorySummary: "",
    memoryIndex: "",
    durableMemory: "",
    localMemory: "",
    cloudRagContext: "",
    staticProfile: "",
    dynamicProfile: "",
    recentSession: "",
  }),
  writeSessionTurn: async () => {},
}))

// Keep conversation-state persistence in-memory only for this test file.
mock.module("../conversation/persistence.js", () => ({
  loadStateFromDisk: () => {},
  saveStateToDisk: () => {},
}))

// ---------------------------------------------------------------------------
// Imports after mocks are registered
// ---------------------------------------------------------------------------

import { agentPipeline } from "./agent.js"
import { getConversationState, resetConversationState } from "../conversation/conversation-state.js"
import type { SseEvent } from "@yomi/shared"

async function collect(gen: AsyncGenerator<SseEvent>): Promise<SseEvent[]> {
  const events: SseEvent[] = []
  for await (const ev of gen) events.push(ev)
  return events
}

// Minimal Hooks stub — no guardrail/memory side effects, just pass-through.
const stubHooks: Hooks = {
  onSessionStart: async () => {},
  onUserPromptSubmit: async () => {},
  onPreToolUse: async () => ({ ok: true }),
  onPostToolUse: async (_name, result) => result,
  onStop: async () => {},
  onSessionEnd: async () => {},
}

const TEST_KEY = "test:agent-pipeline-turns"

describe("agentPipeline — conversation state recording", () => {
  beforeEach(() => {
    streamChunks = ["Hello", " world", "!"]
    resetConversationState(TEST_KEY)
  })

  it("records a user turn and an assistant turn with the full accumulated text, even with TTS disabled", async () => {
    streamChunks = ["The weather ", "in Paris is ", "sunny today."]
    await collect(
      agentPipeline(
        { text: "what's the weather in Paris", tts: false, skipReserve: true, conversationId: TEST_KEY },
        { hooks: stubHooks },
      ),
    )

    const state = getConversationState(TEST_KEY)
    expect(state.turns).toHaveLength(2)
    expect(state.turns[0]).toMatchObject({
      role: "user",
      text: "what's the weather in Paris",
    })
    // This is exactly the behavior the fix changed: fullText used to only
    // accumulate `if (ttsEnabled)`, so with tts:false this turn would have
    // been skipped entirely (fullText.trim() === "" gates addTurn).
    expect(state.turns[1]).toMatchObject({
      role: "assistant",
      text: "The weather in Paris is sunny today.",
    })
  })

  it("records turns identically when TTS is enabled, proving accumulation is unconditional", async () => {
    streamChunks = ["Sure, ", "done."]
    await collect(
      agentPipeline(
        { text: "do the thing", tts: true, skipReserve: true, conversationId: TEST_KEY },
        { hooks: stubHooks },
      ),
    )

    const state = getConversationState(TEST_KEY)
    expect(state.turns).toHaveLength(2)
    expect(state.turns[1]).toMatchObject({ role: "assistant", text: "Sure, done." })
  })

  it("appends across turns instead of resetting conversation state each call", async () => {
    streamChunks = ["First reply."]
    await collect(
      agentPipeline(
        { text: "first message", tts: false, skipReserve: true, conversationId: TEST_KEY },
        { hooks: stubHooks },
      ),
    )

    streamChunks = ["Second reply."]
    await collect(
      agentPipeline(
        { text: "second message", tts: false, skipReserve: true, conversationId: TEST_KEY },
        { hooks: stubHooks },
      ),
    )

    const state = getConversationState(TEST_KEY)
    expect(state.turns).toHaveLength(4)
    expect(state.turns.map((t) => t.text)).toEqual([
      "first message",
      "First reply.",
      "second message",
      "Second reply.",
    ])
  })
})
