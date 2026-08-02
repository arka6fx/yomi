import { describe, expect, it } from "bun:test"
import { createDelegateTool, type CreateDelegateToolOptions } from "./delegate.js"
import type { RunAgentLoopOptions } from "./agent.js"

const fakeRegistry = {} as CreateDelegateToolOptions["registry"]

describe("createDelegateTool", () => {
  it("returns a tool with the correct shape", () => {
    const t = createDelegateTool({ registry: fakeRegistry, runLoop: async () => "" })
    expect(t).toBeDefined()
    expect(typeof t.description).toBe("string")
    expect(t.description).toContain("sub-agent")
    expect(t.parameters).toBeDefined()
  })

  it("calls the sub-loop with the task as text, no history, no extraTools", async () => {
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "sub-agent result"
    }
    const t = createDelegateTool({ registry: fakeRegistry, model: "gpt-5.5", runLoop })

    const result = await t.execute!({ task: "find the latest PR" }, {} as never)

    expect(captured).not.toBeNull()
    expect(captured!.text).toBe("find the latest PR")
    expect(captured!.history).toBeUndefined()
    expect(captured!.extraTools).toBeUndefined()
    expect(captured!.registry).toBe(fakeRegistry)
    expect(captured!.model).toBe("gpt-5.5")
    expect(result).toEqual({ result: "sub-agent result" })
  })

  it("bounds the sub-loop to a fixed small budget regardless of caller intent", async () => {
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "ok"
    }
    const t = createDelegateTool({ registry: fakeRegistry, runLoop })

    await t.execute!({ task: "x" }, {} as never)

    expect(captured!.maxSteps).toBe(8)
    expect(captured!.maxOutputTokens).toBe(4096)
  })

  it("passes the signal through to the sub-loop", async () => {
    const controller = new AbortController()
    let captured: RunAgentLoopOptions | null = null
    const runLoop = async (opts: RunAgentLoopOptions) => {
      captured = opts
      return "ok"
    }
    const t = createDelegateTool({ registry: fakeRegistry, signal: controller.signal, runLoop })

    await t.execute!({ task: "x" }, {} as never)

    expect(captured!.signal).toBe(controller.signal)
  })

  it("allows exactly 3 delegations per tool instance, then returns an error", async () => {
    let calls = 0
    const runLoop = async () => {
      calls++
      return `result ${calls}`
    }
    const t = createDelegateTool({ registry: fakeRegistry, runLoop })

    const r1 = await t.execute!({ task: "a" }, {} as never)
    const r2 = await t.execute!({ task: "b" }, {} as never)
    const r3 = await t.execute!({ task: "c" }, {} as never)
    const r4 = await t.execute!({ task: "d" }, {} as never)

    expect(r1).toEqual({ result: "result 1" })
    expect(r2).toEqual({ result: "result 2" })
    expect(r3).toEqual({ result: "result 3" })
    expect(r4).toEqual({ error: "delegation limit (3 per turn) reached" })
    expect(calls).toBe(3)
  })

  it("does not call the sub-loop at all once the cap is reached", async () => {
    let calls = 0
    const runLoop = async () => {
      calls++
      return "x"
    }
    const t = createDelegateTool({ registry: fakeRegistry, runLoop })

    for (let i = 0; i < 5; i++) await t.execute!({ task: `task ${i}` }, {} as never)

    expect(calls).toBe(3)
  })

  it("constructing without a runLoop override does not throw (defaults to the real runAgentLoop)", () => {
    expect(() => createDelegateTool({ registry: fakeRegistry })).not.toThrow()
  })
})
