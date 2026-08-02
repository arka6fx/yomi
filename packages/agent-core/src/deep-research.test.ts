import { describe, expect, it } from "bun:test"
import { createDeepResearchTool, type CreateDeepResearchToolOptions } from "./deep-research.js"
import type { RunAgentLoopOptions } from "./agent.js"

const fakeRegistry = {} as CreateDeepResearchToolOptions["registry"]
const ragSearch: CreateDeepResearchToolOptions["ragSearch"] = async () => []
const memorySearch: CreateDeepResearchToolOptions["memorySearch"] = async () => []
const webSearch: CreateDeepResearchToolOptions["webSearch"] = async () => ({
  answer: "",
  citations: [],
})

describe("createDeepResearchTool", () => {
  it("returns a tool with the correct shape", () => {
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch,
      memorySearch,
      webSearch,
      runLoop: async () => "",
    })
    expect(t).toBeDefined()
    expect(typeof t.description).toBe("string")
    expect(t.description).toContain("cited")
    expect(t.parameters).toBeDefined()
  })

  it("calls the sub-loop with the question as text and rag/memory/web tools, no delegate/deep_research", async () => {
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "synthesized answer"
    }
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch,
      memorySearch,
      webSearch,
      model: "gpt-5.5",
      runLoop,
    })

    const result = await t.execute!(
      { question: "what changed in yomi memory this week" },
      {} as never,
    )

    expect(captured).not.toBeNull()
    expect(captured!.text).toBe("what changed in yomi memory this week")
    expect(captured!.registry).toBe(fakeRegistry)
    expect(captured!.model).toBe("gpt-5.5")
    expect(Object.keys(captured!.extraTools ?? {}).sort()).toEqual([
      "memory_search",
      "rag_search",
      "web_search",
    ])
    expect(result).toEqual({ result: "synthesized answer" })
  })

  it("bounds the sub-loop to a fixed budget larger than delegate's", async () => {
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "ok"
    }
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch,
      memorySearch,
      webSearch,
      runLoop,
    })

    await t.execute!({ question: "x" }, {} as never)

    expect(captured!.maxSteps).toBe(12)
    expect(captured!.maxOutputTokens).toBe(6144)
  })

  it("prepends citation instructions to the passed-through system prompt", async () => {
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "ok"
    }
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch,
      memorySearch,
      webSearch,
      system: "Today is Tuesday, in Asia/Kolkata.",
      runLoop,
    })

    await t.execute!({ question: "x" }, {} as never)

    expect(captured!.system).toContain("[source:")
    expect(captured!.system).toContain("[memory:")
    expect(captured!.system).toContain("Today is Tuesday, in Asia/Kolkata.")
  })

  it("passes signal and onUsage through to the sub-loop", async () => {
    const controller = new AbortController()
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "ok"
    }
    const usageEvents: unknown[] = []
    const onUsage = (usage: unknown) => usageEvents.push(usage)
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch,
      memorySearch,
      webSearch,
      signal: controller.signal,
      onUsage,
      runLoop,
    })

    await t.execute!({ question: "x" }, {} as never)

    expect(captured!.signal).toBe(controller.signal)
    expect(captured!.onUsage).toBe(onUsage)
  })

  it("allows exactly 2 research calls per tool instance, then returns an error", async () => {
    let calls = 0
    const runLoop = async () => {
      calls++
      return `result ${calls}`
    }
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch,
      memorySearch,
      webSearch,
      runLoop,
    })

    const r1 = await t.execute!({ question: "a" }, {} as never)
    const r2 = await t.execute!({ question: "b" }, {} as never)
    const r3 = await t.execute!({ question: "c" }, {} as never)

    expect(r1).toEqual({ result: "result 1" })
    expect(r2).toEqual({ result: "result 2" })
    expect(r3).toEqual({ error: "research limit (2 per turn) reached" })
    expect(calls).toBe(2)
  })

  it("constructing without a runLoop override does not throw (defaults to the real runAgentLoop)", () => {
    expect(() =>
      createDeepResearchTool({ registry: fakeRegistry, ragSearch, memorySearch, webSearch }),
    ).not.toThrow()
  })

  it("the rag_search tool calls the injected ragSearch callback", async () => {
    let calledArgs: [string, number] | null = null
    const spyRagSearch: CreateDeepResearchToolOptions["ragSearch"] = async (query, limit) => {
      calledArgs = [query, limit]
      return [{ sourceName: "Notes", title: "Notes", content: "hello" }]
    }
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "ok"
    }
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch: spyRagSearch,
      memorySearch,
      webSearch,
      runLoop,
    })
    await t.execute!({ question: "x" }, {} as never)

    const ragTool = captured!.extraTools!["rag_search"] as {
      execute: (args: { query: string; limit?: number }, ctx: never) => Promise<unknown>
    }
    const result = await ragTool.execute({ query: "editor config" }, {} as never)

    expect(calledArgs).toEqual(["editor config", 5])
    expect(result).toEqual([{ sourceName: "Notes", title: "Notes", content: "hello" }])
  })

  it("returns an error instead of throwing when the sub-loop rejects", async () => {
    const runLoop = async () => {
      throw new Error("model unavailable")
    }
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch,
      memorySearch,
      webSearch,
      runLoop,
    })

    const result = await t.execute!({ question: "x" }, {} as never)

    expect(result).toEqual({ error: "model unavailable" })
  })

  it("the memory_search tool calls the injected memorySearch callback", async () => {
    let calledArgs: [string, number] | null = null
    const spyMemorySearch: CreateDeepResearchToolOptions["memorySearch"] = async (query, limit) => {
      calledArgs = [query, limit]
      return []
    }
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "ok"
    }
    const t = createDeepResearchTool({
      registry: fakeRegistry,
      ragSearch,
      memorySearch: spyMemorySearch,
      webSearch,
      runLoop,
    })
    await t.execute!({ question: "x" }, {} as never)

    const memTool = captured!.extraTools!["memory_search"] as {
      execute: (args: { query: string; limit?: number }, ctx: never) => Promise<unknown>
    }
    await memTool.execute({ query: "editor preference", limit: 3 }, {} as never)

    expect(calledArgs).toEqual(["editor preference", 3])
  })
})
