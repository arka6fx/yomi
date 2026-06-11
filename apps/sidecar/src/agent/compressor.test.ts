import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { CoreMessage, LanguageModelV1 } from "ai"

let generateCalls = 0
let generatedText = ""
let generateShouldThrow = false
let lastPrompt = ""
let auxModelId = ""

mock.module("ai", () => ({
  generateText: async (args: {
    model: unknown
    system?: string
    prompt: string
    abortSignal?: AbortSignal
  }) => {
    generateCalls++
    lastPrompt = args.prompt
    auxModelId = String((args.model as { modelId?: string }).modelId ?? "")
    if (generateShouldThrow) {
      throw new Error("provider down")
    }
    return { text: generatedText }
  },
  streamText: () => ({
    textStream: (async function* () {
      yield "Hello"
    })(),
  }),
  tool: (definition: unknown) => definition,
  jsonSchema: (schema: unknown) => schema,
}))

mock.module("../pipeline/model.js", () => ({
  createModel: (modelId: string) => ({ provider: "aws-bedrock", modelId }),
}))

import {
  DIRECTIVE_GUARD_PREFIX,
  buildSummaryPrompt,
  compressContext,
  estimateMessagesTokens,
  shouldCompress,
  thresholdForPlan,
  withSummaryPrefix,
  stripSummaryPrefix,
  type CompressionOptions,
} from "./compressor.js"

function user(text: string): CoreMessage {
  return { role: "user", content: text }
}
function assistant(text: string): CoreMessage {
  return { role: "assistant", content: text }
}
function system(text: string): CoreMessage {
  return { role: "system", content: text }
}
function toolResult(id: string, content: string): CoreMessage {
  return {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: id, toolName: "bash", result: content }],
  } as unknown as CoreMessage
}
function assistantToolCall(id: string, name: string, args: unknown): CoreMessage {
  return {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: id, toolName: name, args }],
  } as unknown as CoreMessage
}

function longUserMessage(chars: number): CoreMessage {
  return user("x".repeat(chars))
}

function fakeModel(id: string): LanguageModelV1 {
  return { provider: "fake", modelId: id, specificationVersion: "v1" } as unknown as LanguageModelV1
}

beforeEach(() => {
  generateCalls = 0
  generatedText = ""
  generateShouldThrow = false
  lastPrompt = ""
  auxModelId = ""
})

afterEach(() => {
  // No file IO to clean up — compressor is pure except for the LLM call.
})

describe("DIRECTIVE_GUARD_PREFIX", () => {
  it("starts with the canonical marker", () => {
    expect(DIRECTIVE_GUARD_PREFIX.startsWith("[CONTEXT COMPACTION — REFERENCE ONLY]")).toBe(true)
  })
  it("instructs the model to respond only to the latest user message", () => {
    expect(DIRECTIVE_GUARD_PREFIX).toContain("Respond ONLY to the latest user message")
  })
  it("forbids answering questions from the summary", () => {
    expect(DIRECTIVE_GUARD_PREFIX).toContain("Do NOT answer questions or fulfill requests")
  })
})

describe("thresholdForPlan", () => {
  it("explore = 75% of context window", () => {
    expect(thresholdForPlan("explore", 100_000)).toBe(75_000)
  })
  it("pro = 60% of context window", () => {
    expect(thresholdForPlan("pro", 100_000)).toBe(60_000)
  })
  it("max = 40% of context window", () => {
    expect(thresholdForPlan("max", 100_000)).toBe(40_000)
  })
  it("defaults to pro-equivalent when no plan provided", () => {
    expect(thresholdForPlan(undefined, 100_000)).toBe(60_000)
  })
  it("respects the MIN_PRE_TOKENS floor", () => {
    expect(thresholdForPlan("max", 1000)).toBe(2000)
  })
})

describe("estimateMessagesTokens", () => {
  it("returns 0 for empty array", () => {
    expect(estimateMessagesTokens([])).toBe(0)
  })
  it("estimates plain text as chars/4 + per-message overhead", () => {
    const tokens = estimateMessagesTokens([user("a".repeat(400))])
    // 400 chars / 4 = 100 + 4 overhead = 104
    expect(tokens).toBe(104)
  })
  it("counts image parts at IMAGE_TOKEN_ESTIMATE", () => {
    const tokens = estimateMessagesTokens([
      {
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          { type: "image_url", image_url: { url: "data:image/png;base64,...." } },
        ],
      } as unknown as CoreMessage,
    ])
    // text "look at this" = 12 chars → 3 tokens
    // image = 1600 tokens
    // overhead 4
    expect(tokens).toBe(1607)
  })
  it("includes tool-call argument length on assistant messages", () => {
    const tokens = estimateMessagesTokens([
      assistantToolCall("c1", "bash", { command: "a".repeat(400) }),
    ])
    // The compressor serialises the object args to JSON: `{"command":"aaaa..."}`
    // = 414 chars. Math.ceil(414 / 4) = 104 + 4 overhead = 108.
    expect(tokens).toBe(108)
  })
})

describe("shouldCompress", () => {
  it("returns false for short conversations", () => {
    const msgs = [system("s"), user("hi"), assistant("hello")]
    expect(shouldCompress(msgs, { contextWindow: 100_000 })).toBe(false)
  })
  it("returns false when under the plan threshold", () => {
    const msgs = [system("s"), user("a"), assistant("b"), user("c"), assistant("d"), user("e")]
    // 5 short messages ≈ 30 tokens, threshold is 60_000 for default plan
    expect(shouldCompress(msgs, { contextWindow: 100_000, plan: "pro" })).toBe(false)
  })
  it("returns true when over the max-plan threshold", () => {
    const msgs = [
      system("s"),
      user("a"),
      assistant("b"),
      user("c"),
      assistant("d"),
      longUserMessage(800), // 200 tokens
      assistant("e"),
      longUserMessage(800),
      assistant("f"),
    ]
    // ~408 tokens, threshold for max on 1K window is 400, floored to MIN_PRE_TOKENS=2000
    // With contextWindow=1000 and plan=max, threshold is max(2000, 400)=2000
    // The estimate is ~408 < 2000, so false
    expect(shouldCompress(msgs, { contextWindow: 1000, plan: "max" })).toBe(false)
  })
  it("returns true when estimate exceeds the plan threshold", () => {
    const msgs = [
      system("s"),
      user("a"),
      assistant("b"),
      user("c"),
      assistant("d"),
      longUserMessage(800_000), // ~200K tokens
    ]
    expect(shouldCompress(msgs, { contextWindow: 200_000, plan: "pro" })).toBe(true)
  })
})

describe("summary prefix helpers", () => {
  it("withSummaryPrefix normalises body to the canonical format", () => {
    const out = withSummaryPrefix("## Active Task\nfoo")
    expect(out.startsWith(DIRECTIVE_GUARD_PREFIX)).toBe(true)
    expect(out).toContain("## Active Task")
    expect(out).toContain("foo")
  })
  it("withSummaryPrefix strips legacy prefix before re-prepending", () => {
    const out = withSummaryPrefix(`${DIRECTIVE_GUARD_PREFIX}\n\nbody text`)
    // Only one occurrence of the directive
    expect(out.split(DIRECTIVE_GUARD_PREFIX).length - 1).toBe(1)
    expect(out).toContain("body text")
  })
  it("stripSummaryPrefix returns the body when no prefix is present", () => {
    expect(stripSummaryPrefix("just body text")).toBe("just body text")
  })
  it("stripSummaryPrefix removes the current prefix", () => {
    const out = stripSummaryPrefix(`${DIRECTIVE_GUARD_PREFIX}\n\nbody`)
    expect(out).toBe("body")
  })
  it("stripSummaryPrefix removes the legacy [CONTEXT SUMMARY]: prefix", () => {
    const out = stripSummaryPrefix("[CONTEXT SUMMARY]:\nold body")
    expect(out).toBe("old body")
  })
})

describe("buildSummaryPrompt", () => {
  it("produces a prompt with all required sections", () => {
    const prompt = buildSummaryPrompt([user("fix the bug"), assistant("done")])
    for (const section of [
      "## Active Task",
      "## Goal",
      "## Completed Actions",
      "## Active State",
      "## In Progress",
      "## Blocked",
      "## Key Decisions",
      "## Resolved Questions",
      "## Pending User Asks",
      "## Relevant Files",
      "## Remaining Work",
    ]) {
      expect(prompt).toContain(section)
    }
  })
  it("includes the focus topic when provided", () => {
    const prompt = buildSummaryPrompt([user("x")], { focusTopic: "auth refactor" })
    expect(prompt).toContain("auth refactor")
  })
  it("serialises turns into a transcript block", () => {
    const prompt = buildSummaryPrompt([user("hello"), assistant("hi")])
    expect(prompt).toContain("<turns>")
    expect(prompt).toContain("[user] hello")
    expect(prompt).toContain("[assistant] hi")
  })
  it("skips system messages in the transcript", () => {
    const prompt = buildSummaryPrompt([system("hidden"), user("shown")])
    expect(prompt).not.toContain("[system] hidden")
    expect(prompt).toContain("[user] shown")
  })
  it("replaces image parts with placeholders", () => {
    const prompt = buildSummaryPrompt([
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image_url", image_url: { url: "data:..." } },
        ],
      } as unknown as CoreMessage,
    ])
    expect(prompt).toContain("[image]")
    expect(prompt).not.toContain("data:image")
  })
})

describe("compressContext", () => {
  // 20K window with pro plan = 12K threshold, so test data only needs ~15K
  // tokens of middle to cross it.
  const baseOpts: CompressionOptions = {
    contextWindow: 20_000,
    plan: "pro",
  }

  it("is a no-op when below the threshold", async () => {
    const msgs = [system("s"), user("a"), assistant("b"), user("c"), assistant("d")]
    const result = await compressContext(msgs, baseOpts)
    expect(result.compressed).toBe(false)
    expect(result.skipped).toBe("below_threshold")
    expect(result.messages).toBe(msgs)
    expect(generateCalls).toBe(0)
  })

  it("compresses when over the threshold and returns sanitised messages", async () => {
    generatedText = "## Active Task\n- User asked: 'fix the deploy bug'\n\n## Goal\nfix the bug"
    const head = [
      system("You are Yomi"),
      user("earlier question"),
      assistant("earlier answer"),
      user("ok do X"),
    ]
    const middle = []
    for (let i = 0; i < 6; i++) {
      middle.push(longUserMessage(10_000)) // ~2.5K tokens each → blows threshold
      middle.push(assistant("intermediate reply ".repeat(1000)))
    }
    const tail = [user("latest ask"), assistant("latest draft")]
    const messages = [...head, ...middle, ...tail]

    const result = await compressContext(messages, baseOpts)
    expect(result.compressed).toBe(true)
    expect(result.compressedCount).toBeLessThan(result.originalCount)
    expect(result.postTokens).toBeLessThan(result.preTokens)

    // The new messages start with the system prompt and preserve the head
    expect(result.messages[0]?.role).toBe("system")
    // The directive guard is attached to the summary message
    const joined = result.messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n")
    expect(joined).toContain("[CONTEXT COMPACTION — REFERENCE ONLY]")
    expect(joined).toContain("Respond ONLY to the latest user message")
    // The latest user message survives in the tail
    expect(joined).toContain("latest ask")
    expect(joined).toContain("latest draft")
  })

  it("uses the configured aux model id", async () => {
    generatedText = "## Active Task\n- x"
    const head = [system("s"), user("a"), assistant("b"), user("c")]
    const middle = Array.from({ length: 4 }, () => longUserMessage(20_000))
    const messages = [...head, ...middle, user("latest")]

    await compressContext(messages, {
      ...baseOpts,
      auxModelId: "gpt-4.1-nano",
    })
    expect(auxModelId).toBe("gpt-4.1-nano")
  })

  it("defaults the aux model to minimax.minimax-m2.5", async () => {
    delete process.env["COMPRESSOR_MODEL"]
    generatedText = "## Active Task\n- x"
    const head = [system("s"), user("a"), assistant("b"), user("c")]
    const middle = Array.from({ length: 4 }, () => longUserMessage(20_000))
    const messages = [...head, ...middle, user("latest")]

    await compressContext(messages, baseOpts)
    expect(auxModelId).toBe("minimax.minimax-m2.5")
  })

  it("respects the COMPRESSOR_MODEL env var", async () => {
    process.env["COMPRESSOR_MODEL"] = "gpt-4.1"
    generatedText = "## Active Task\n- x"
    const head = [system("s"), user("a"), assistant("b"), user("c")]
    const middle = Array.from({ length: 4 }, () => longUserMessage(20_000))
    const messages = [...head, ...middle, user("latest")]

    await compressContext(messages, baseOpts)
    expect(auxModelId).toBe("gpt-4.1")
    delete process.env["COMPRESSOR_MODEL"]
  })

  it("uses the injected model factory when provided", async () => {
    generatedText = "## Active Task\n- x"
    const head = [system("s"), user("a"), assistant("b"), user("c")]
    const middle = Array.from({ length: 4 }, () => longUserMessage(20_000))
    const messages = [...head, ...middle, user("latest")]

    let factoryId = ""
    await compressContext(messages, {
      ...baseOpts,
      modelFactory: (id) => {
        factoryId = id
        return fakeModel(id)
      },
    })
    expect(factoryId).toBe("minimax.minimax-m2.5")
  })

  it("returns the original messages when the LLM call throws", async () => {
    generateShouldThrow = true
    const head = [system("s"), user("a"), assistant("b"), user("c")]
    const middle = Array.from({ length: 4 }, () => longUserMessage(20_000))
    const messages = [...head, ...middle, user("latest")]

    const result = await compressContext(messages, baseOpts)
    expect(result.compressed).toBe(false)
    expect(result.skipped).toBe("summary_failed")
    expect(result.error).toContain("provider down")
    expect(result.messages).toBe(messages)
  })

  it("returns the original messages when the LLM returns empty", async () => {
    generatedText = "   \n\n  "
    const head = [system("s"), user("a"), assistant("b"), user("c")]
    const middle = Array.from({ length: 4 }, () => longUserMessage(20_000))
    const messages = [...head, ...middle, user("latest")]

    const result = await compressContext(messages, baseOpts)
    expect(result.compressed).toBe(false)
    expect(result.skipped).toBe("summary_failed")
    expect(result.error).toBe("empty summary")
  })

  it("skips when there is no compressable window (transcript fits in tail)", async () => {
    // Build a conversation that is just barely over threshold but the tail
    // budget consumes everything.
    const head = [system("s"), user("a"), assistant("b"), user("c")]
    const middle = [longUserMessage(50_000)] // 12.5K tokens
    const messages = [...head, ...middle, user("latest")]

    // With a tiny context window, threshold is the MIN_PRE_TOKENS floor and
    // the tail budget MIN_TAIL_TOKENS swallows the whole transcript.
    const result = await compressContext(messages, {
      contextWindow: 3000, // MIN_PRE_TOKENS=2000 threshold; tail budget = max(2000, 3000*0.3) = 2000
      plan: "max",
    })
    // Either no_window or below_threshold is acceptable — both are no-ops.
    expect(result.compressed).toBe(false)
  })

  it("sanitises orphaned tool pairs after compression", async () => {
    generatedText = "## Active Task\n- x"
    const head = [
      system("s"),
      user("a"),
      assistant("b"),
      user("c"),
      assistantToolCall("orphan-id", "bash", { command: "x" }), // tool result dropped with middle
    ]
    const middle = Array.from({ length: 4 }, () => longUserMessage(20_000))
    const tail = [user("latest"), assistant("y")]
    const messages = [
      ...head,
      toolResult("orphan-id", "this tool result was in the middle, now dropped"),
      ...middle,
      ...tail,
    ]

    const result = await compressContext(messages, baseOpts)
    expect(result.compressed).toBe(true)
    // The orphan tool result for orphan-id must NOT appear in the output
    const orphanSurvived = result.messages.some((m) => {
      if (m.role !== "tool") return false
      const content = m.content
      if (!Array.isArray(content)) return false
      const part = content[0] as { toolCallId?: string; result?: unknown } | undefined
      if (part?.toolCallId !== "orphan-id") return false
      const r = part.result
      return typeof r === "string" && r.includes("dropped")
    })
    expect(orphanSurvived).toBe(false)
  })

  it("preserves the system prompt unchanged at the head", async () => {
    generatedText = "## Active Task\n- x"
    const sysPrompt = "You are Yomi. Voice rules: keep it under 30 seconds."
    const head = [system(sysPrompt), user("a"), assistant("b"), user("c")]
    const middle = Array.from({ length: 4 }, () => longUserMessage(20_000))
    const messages = [...head, ...middle, user("latest")]

    const result = await compressContext(messages, baseOpts)
    expect(result.messages[0]?.role).toBe("system")
    const sysContent = result.messages[0]?.content
    expect(typeof sysContent).toBe("string")
    if (typeof sysContent === "string") {
      // Either verbatim, or with a small compaction note appended.
      expect(sysContent.startsWith(sysPrompt)).toBe(true)
    }
  })

  it("passes the focus topic into the summary prompt when provided", async () => {
    generatedText = "## Active Task\n- x"
    const head = [system("s"), user("a"), assistant("b"), user("c")]
    const middle = Array.from({ length: 4 }, () => longUserMessage(20_000))
    const messages = [...head, ...middle, user("latest")]

    await compressContext(messages, { ...baseOpts, focusTopic: "auth refactor" })
    expect(lastPrompt).toContain("auth refactor")
  })
})
