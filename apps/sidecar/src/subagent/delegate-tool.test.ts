import { describe, expect, it, mock } from "bun:test"
import type { SubagentRunOptions, SubagentResult } from "./index.js"

const mockRunSubagent = mock(
  (opts: SubagentRunOptions): Promise<SubagentResult> =>
    Promise.resolve({
      ok: true,
      summary: `done: ${opts.goal}`,
      messages: [],
      toolCalls: 1,
    }),
)

const mockRunSubagentBatch = mock(
  (opts: { tasks: SubagentRunOptions[]; concurrency?: number }): Promise<SubagentResult[]> =>
    Promise.resolve(
      opts.tasks.map((t) => ({
        ok: true,
        summary: `done: ${t.goal}`,
        messages: [],
        toolCalls: 1,
      })),
    ),
)

mock.module("./index.js", () => ({
  runSubagent: mockRunSubagent,
  runSubagentBatch: mockRunSubagentBatch,
}))

const { createDelegateTaskTool } = await import("./delegate-tool.js")

async function callTool(
  tools: Record<string, any>,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = tools[name]
  if (!tool?.execute) throw new Error(`no tool ${name}`)
  return await tool.execute(args, { toolCallId: "t1", messages: [] } as never)
}

describe("createDelegateTaskTool — single delegation", () => {
  it("dispatches a single goal to runSubagent", async () => {
    const tools = createDelegateTaskTool({ plan: "pro" })
    const result = (await callTool(tools, "delegate_task", {
      goal: "audit logs",
    })) as Record<string, unknown>

    expect(result.ok).toBe(true)
    expect(result.summary).toBe("done: audit logs")
    expect(result.tool_calls).toBe(1)
    expect(mockRunSubagent).toHaveBeenCalled()
  })

  it("passes plan context to the subagent", async () => {
    const tools = createDelegateTaskTool({ plan: "max" })
    await callTool(tools, "delegate_task", { goal: "x" })

    const calls = mockRunSubagent.mock.calls
    const call = calls[calls.length - 1]?.[0] as SubagentRunOptions
    expect(call.plan).toBe("max")
  })

  it("rejects orchestrator role on non-Max plan", async () => {
    const tools = createDelegateTaskTool({ plan: "pro" })
    const result = (await callTool(tools, "delegate_task", {
      goal: "x",
      role: "orchestrator",
    })) as Record<string, unknown>

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Max plan/)
  })

  it("allows orchestrator role on Max plan", async () => {
    const tools = createDelegateTaskTool({ plan: "max" })
    const result = (await callTool(tools, "delegate_task", {
      goal: "orchestrate",
      role: "orchestrator",
    })) as Record<string, unknown>

    expect(result.ok).toBe(true)
  })

  it("defaults role to leaf when not specified", async () => {
    const tools = createDelegateTaskTool({ plan: "explore" })
    await callTool(tools, "delegate_task", { goal: "x" })

    const calls = mockRunSubagent.mock.calls
    const call = calls[calls.length - 1]?.[0] as SubagentRunOptions
    expect(call.role).toBe("leaf")
  })
})

describe("createDelegateTaskTool — parallel batch", () => {
  it("dispatches tasks to runSubagentBatch", async () => {
    const tools = createDelegateTaskTool({ plan: "pro" })
    const result = (await callTool(tools, "delegate_task", {
      tasks: [
        { goal: "task a" },
        { goal: "task b" },
      ],
    })) as Record<string, unknown>

    expect(result.ok).toBe(true)
    expect((result.results as Record<string, unknown>[])).toHaveLength(2)
    expect(mockRunSubagentBatch).toHaveBeenCalled()
  })

  it("passes concurrency to runSubagentBatch", async () => {
    const tools = createDelegateTaskTool({ plan: "max" })
    await callTool(tools, "delegate_task", {
      tasks: [{ goal: "a" }, { goal: "b" }, { goal: "c" }],
      concurrency: 2,
    })

    const calls = mockRunSubagentBatch.mock.calls
    const call = calls[calls.length - 1]?.[0] as {
      tasks: SubagentRunOptions[]
      concurrency: number
    }
    expect(call.concurrency).toBe(2)
  })

  it("rejects concurrency > 5", async () => {
    const tools = createDelegateTaskTool({ plan: "max" })
    const result = (await callTool(tools, "delegate_task", {
      tasks: [{ goal: "a" }],
      concurrency: 10,
    })) as Record<string, unknown>

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/concurrency/)
  })
})

describe("createDelegateTaskTool — validation", () => {
  it("rejects when both goal and tasks are set", async () => {
    const tools = createDelegateTaskTool({ plan: "pro" })
    const result = (await callTool(tools, "delegate_task", {
      goal: "x",
      tasks: [{ goal: "y" }],
    })) as Record<string, unknown>

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/both/)
  })

  it("rejects when neither goal nor tasks is set", async () => {
    const tools = createDelegateTaskTool({ plan: "pro" })
    const result = (await callTool(tools, "delegate_task", {})) as Record<string, unknown>

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/either goal/)
  })
})

